"use strict";
// if a server hasn't contacted us in this many seconds it's assumed to be offline
var serverContactTimeLimit = 5 * 60;

// text sent to anyone who happens to contact the master server outside of ED
var welcomeText = "<h1>Hi there.</h1>" +
        "<p>This is a master server for ElDewrito (a Halo Online fan mod), to use this master server you'll need to use a server browser.</p>" +
        "<h3>Useful links</h3>" +
        "<ul><li><a href=\"https://www.reddit.com/r/HaloOnline\">/r/HaloOnline, the Halo Online subreddit</a> - Information about HaloOnline and ElDewrito can be found here.</li>" +
        "<li><a href=\"https://forum.halo.click\">Halo.Click Forums</a> - The official forums for ElDewrito.</li><ul>" +
        "<p>The source code for this master server can be downloaded from <a href=\"https://gitlab.com/ElDewrito/ElDewrito-MasterServer\">GitLab</a><p>";

// if you're running this server behind a forward proxy (ie. a caching server, or with nginx hosting the frontend) set this to true
// this will allow the master server to get the server IP from the X-Forwarded-For header instead of the remote_addr
// which is needed since a forward proxy would have remote_addr set to the proxies IP, not the server which is contacting us
// DISABLE THIS IF YOU'RE NOT USING A FORWARD PROXY, the X-Forwarded-For header can be easily spoofed if you don't have a proxy which is setting it
// if someone spoofs it they could fill your master with dozens of fake announce requests!
var isRunningBehindProxy = true;

// the information for the redis server, the defaults here correspond with the /etc/hosts entries created by Docker
var redisHostName = "redis";
var redisPortNumber = "6379";

// the default port number for this application, if you're using the Docker install you should leave this as 8080 and edit the nginx config instead
var appPortNumber = process.env.PORT || 8080;

// if you run a stats server you should also edit the /stats route below to do something with stats data
var isRunningStatsServer = false;

// end of configurable options, only edit below if you know what you're doing!
var express = require('express'),
    http = require('http'),
    request = require('request'),
    redis = require('redis'),
    async = require('async'),
    bodyParser = require('body-parser'),
    crypto = require('crypto');

var app = express();
var client = redis.createClient(redisPortNumber, redisHostName);

function jsonGet(options, callback) {
    return request(options, function (error, response, body) {
        if (error || response.statusCode !== 200) {
            return callback({error: "true"});
        }
        var data;
        try {
            data = JSON.parse(body);
        } catch (ex) {
            console.log("error contacting", options.uri, ":", ex);
            data = {error: "true"};
        }
        return callback(data);
    });
}

/*
  /announce - used by game servers to announce their server to this master server
  GET parameters:
  - port (int) - port number of the JSON info server
  - shutdown (bool) - specified if the server is shutting down, to let the master know to remove it

  This route connects to $REMOTE_ADDR:$PORT and makes sure the JSON info server is accessible
  then checks if the "port" (game port number) specified in the JSON is accessible
  If they're both accessible then it adds the server to the Redis database (or updates the lastUpdate time if it already exists)

  If shutdown is specified it'll remove the $REMOTE_ADDR:$PORT entry from Redis.

  Game servers should keep contacting the /announce route every two minutes or so to make sure its entry doesn't expire.

  Returns a JSON object like below, letting the client know the status of the announce request
  {
    "result": {
      "code": 0,
      "msg": "OK"
    }
  }
*/
app.get('/announce', function (req, res) {
    var shutdown = req.query.shutdown !== undefined ? (req.query.shutdown === "true" || req.query.shutdown === "1") : false;
    var serverPort = req.query.port || 0;
    if (serverPort === 0) {
        return res.send({result: {code: 1, msg: "Invalid parameters, valid parameters are 'port' (int) and 'shutdown' (bool)"}});
    }

    var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (!isRunningBehindProxy) {
        ip = req.connection.remoteAddress;
    }

    var uri = ip + ":" + serverPort;

    if (shutdown) { // server shutting down so delete its entries from redis
        client.srem("servers", uri);
        client.del(uri + ":info");
        return res.send({result: {code: 0, msg: "Removed server from list"}});
        console.log("Removed server", uri);
    }

    jsonGet({uri: "http://" + uri + "/", timeout: 10 * 1000}, function (json) {
        var isError = json.error !== undefined ? json.error === "true" : false;
        if (isError) {
            return res.send({result: {code: 2, msg: "Failed to retrieve server info JSON from " + uri}});
        }

        var serverGamePort = json.port || 11774;

        var gamePortIsOpen = true; // todo: check if game port is accessible
        if (!gamePortIsOpen) {
            return res.send({result: {code: 3, msg: "Failed to contact game server, are the ports open and forwarded correctly?"}});
        }

        // add ip to our servers set, if it already exists then it'll silently fail
        client.sadd("servers", uri);

        // add/set the ip/port and current time to the db
        client.hmset(uri + ":info", {lastUpdate: Math.floor(Date.now() / 1000)});

        res.send({result: {code: 0, msg: "Added server to list"}});
        console.log("Added server", uri);
    });
});

/*
  /list - used by client server browsers to retrieve a list of game servers
  GET parameters:
  - maxListVersion (int) - max list version supported by the server browser (unimplemented)

  List version 1 would just be a simple list of servers, version 2 may include some cached data about the server
  To ensure masters will work with any server browser, no matter what listVersion they support, masters will have to honor the maxListVersion given
  Alternatively we could just make the JSON reply always stay backwards compatible, ie. instead of changing any of the fields we'd only add new ones

  This route simply goes through each entry in the "servers" Redis set, and then looks up the last update time for that entry
  If the last update was less than MAXIMUM_TIME_BEFORE_SERVER_PRONOUNCED_DEAD then it's added to the returned JSON

  Returns a JSON object like below, letting the client know the status of the request along with a list of servers
  {
    "listVersion": 1,
    "result": {
      "code": 0,
      "msg": "OK",
      "servers": [
        "192.168.0.1:11775",
        "127.0.0.1:11775"
      ]
    }
  }
*/

app.get("/list", function (req, res) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Credentials", true);
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    var returnData = {listVersion: 1, result: {code: 0, msg: "OK", servers: []}};

    client.smembers("servers", function (err, result) {
        if (!result) {
            returnData.result.code = 1;
            returnData.result.msg = "Unable to query database";
            return res.send(returnData);
        }

        function isServerAvailable(uri, callback) {
            client.hgetall(uri + ":info", function (err, obj) {
                // can this be simplified? things i've read from ~2010 say this is the best way
                if (err || typeof obj === undefined || !obj || typeof obj.lastUpdate === undefined || !obj.lastUpdate || obj.lastUpdate === 0) {
                    return callback(false);
                }

                var currentTime = Math.floor(Date.now() / 1000);
                var lastUpdate = parseInt(obj.lastUpdate);
                if (currentTime - lastUpdate > serverContactTimeLimit) {
                    return callback(false);
                }

                callback(true);
            });
        }

        async.filter(result, isServerAvailable, function (results) {
            returnData.result.servers = results;
            return res.send(returnData);
        });
    });
});

app.all("/", function (req, res) {
    res.send(welcomeText);
});

var jsonParser = bodyParser.json();

/*
  /stats - used by clients after game ends to record their stats
  GET parameters:
  - none
  
  POST data: JSON in the format:
  {
    "statsVersion": 1,
    "stats": "{\"gameId\": 122334455, \"kills\": 21, \"deaths\": 0, \"assists\": 1, \"medals\": [\"doublekill\", \"triplekill\", \"overkill\", \"unfreakingbelieveable\"]",
    "publicKey": "base64 encoded public key",
    "signature": "base64 encoded signature"
  }
  
  When received by the master, the master should first make sure the stats signature is valid for that public key.
  Once it's been verified the master can trust that the stats belong to that public key, and the public key itself can be used as an identifier for the user.
  To make the identifier shorter a hash should be made of the public key (the actual public key data sent by the client unmodified)
  In ElDewrito we use a SHA256 hash of this key and copy the first 8 bytes of it to serve as the user ID, stats services should use the full hash and allow users to look up players from partial hashes.
  
  I chose this method for stats recording for a number of reasons:
  - We can trust that these stats are from that user, no other user can pretend to be another one unless they steal the private key (security is main priority for a stats system IMO)
  
  - This system is decentralized, stats can be sent to multiple master servers at once, none of them needing to know the users secret (eg. needing to hold a users login/password, or in this case the private key)
  
  - Everything sent by the client (pubkey, signature, stats data) could be shown publicly, with no risk to the user, allowing them to verify their stats haven't been tampered with by the server operator or others
  
  - Future-proof: if every stats server suddenly closed others can easily start new servers
    stats server owners could even make their database public if they decide to shut down or something, with no security risk by doing so
    others can import that database and users will be able to update their stats with the same key they used before.
  
  - Identifiers based on the public key could be tied with a login system easily (could maybe implement something ingame so that private key holders have to confirm they want a login tied to it though)
  
  - As players stats are tied to this public key, and their in-game identifier is tied to it too, banning players based on it could be possible (a la steam IDs)
   (although they can easily change it they would lose their stats too, hacking to make stats look better is one of the main reasons people hack afaik)
  
  Although it does have it's drawbacks:
  - To sync stats between machines people would have to copy their private key over, some might not be able to do this, but if they can't copy a file it's a wonder that they managed to install ED at all..
  
  - If you lose your private key you have no chance of recovering it, stopping you from ever updating your stats again (arrangements can probably be made with stats server owners to move stats to a new key though)
  
  - Since stats recording is done by the client it wouldn't take much effort to report fake stats for themselves
    (It'd take a bit more effort but server-side stats could also have fake stats reported too, but having server-side stats means people can mess with other peoples stats too if they know the user id)
    I figured if people are going to cheat they will, but with this system there's no way they can mess around with other peoples stats, which is more of a priority than fudging with your own
    
  - 

  Returns a JSON object like below, letting the client know the status of the request
  {
    "result": {
      "code": 0,
      "msg": "OK"
    }
  }
*/
app.post("/stats", jsonParser, function (req, res) {
    function ReformatKey(isPrivateKey, key) {
        var pos = 0;
        var returnKey = "";
        while (pos < key.length) {
            var toCopy = key.length - pos;
            if (toCopy > 64)
                toCopy = 64;
            returnKey += key.substr(pos, toCopy);
            returnKey += "\n";
            pos += toCopy;
        }
        var keyType = (isPrivateKey ? "RSA PRIVATE KEY" : "PUBLIC KEY"); // public keys don't have RSA in the name some reason
        return "-----BEGIN " + keyType + "-----\n" + returnKey + "-----END " + keyType + "-----\n";
    }
    if(!isRunningStatsServer)
        return res.send({result: {code: 1, msg: "Stats are unsupported on this master server"}});
    
    if(!req.body || !req.body.publicKey || !req.body.signature || !req.body.stats)
        return res.send({result: {code: 2, msg: "Invalid stats data"}});

    var pubKey = ReformatKey(false, req.body.publicKey);

    var verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(req.body.stats);
    var isValidSig = verifier.verify(pubKey, req.body.signature, "base64");

    if(!isValidSig) {
        return res.send({result: {code: 3, msg: "Stats signature invalid"}});
    }

    // At this point the stats have been verified to be signed by req.body.publicKey
    // SHA256(req.body.publicKey) can be used as an identifier for this user
    // (in eldewrito we only use the first 8 bytes of the hash for in-game uids, it'd be best to use the full hash in your backend though
    // and use partial hash matching on your frontend site, so "af12bcdedebc12af" would match "af12bcdedebc12afbeefcafe1337dead", or whatever the closest hash known to you is)
    // nobody else can send stats for this user unless they somehow steal the users private key

    // here you could send a POST request to your stats server
    // sending req.body.stats to something like http://mydewritostatssite.com/api/updateStats?userId=( SHA256(req.body.publicKey) )
    // req.body.stats is already formatted as JSON, so you can send that directly
    // (of course your updateStats API should have some sort of access control so that only this master server can contact it, etc..)
    // or you could build in a direct database connection here to store it directly, it's open source code, do with it whatever you like :)
    
    // Note that if you want to build a truly trustable system, where players could verify their stats haven't been tampered with etc, you'd have to store everything the client sent as they sent it
    // (So you'd need to store the signature, public key and the req.body.stats string)
    // This data could all be shown publicly, allowing players to see that the data on the server was signed by them and proving it hasn't been tampered with

    // if you have a login system on your site you could also allow people to claim that SHA256 hash as their own, so stats can be linked to a login/pw
    // could also maybe allow people to upload their cfg to backup priv keys too

    // console.log("verified:", isValidSig, req.body);

    res.send({result: {code: 0, msg: "OK"}});
});

http.createServer(app).listen(appPortNumber, "0.0.0.0", function () {
    console.log('Listening on port ' + appPortNumber);
});
