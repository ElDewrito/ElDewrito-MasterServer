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

// end of configurable options, only edit below if you know what you're doing!
var express = require('express'),
    http = require('http'),
    request = require('request'),
    redis = require('redis'),
    async = require('async');

var app = express();
var client = redis.createClient(redisPortNumber, redisHostName);

function jsonGet(options, callback) {
    return request(options, function (error, response, body) {
        if (error || response.statusCode !== 200) {
            return callback({error: "true"});
        }

        return callback(JSON.parse(body));
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

http.createServer(app).listen(appPortNumber, function () {
    console.log('Listening on port ' + appPortNumber);
});
