var express = require('express'),
    http = require('http'),
    redis = require('redis');

var MAXIMUM_TIME_BEFORE_SERVER_PRONOUNCED_DEAD = 5 * 60;

var app = express();

// use host entries created by Docker in /etc/hosts to connect to redis
var client = redis.createClient('6379', 'redis');

function jsonGet(options: any, callback: any) {
    return http.get(options, function (resp) {
        var data = "";
        resp.on("data", function (chunk) { data += chunk; });

        resp.on("end", function () { callback(JSON.parse(data)); });

        resp.on("error", function (err) { callback({error: "true"}); });
    });
}

app.get('/announce', function (req, res) {
    var shutdown = req.query.shutdown != undefined ? (req.query.shutdown == "true" || req.query.shutdown == "1") : false;
    var serverPort = req.query.port || 0;
    if (serverPort == 0)
        return res.send({ result: 1, msg: "Invalid parameters, valid parameters are 'port' (int) and 'shutdown' (bool)" });

    var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    var uri = ip + ":" + serverPort;

    var req = jsonGet({ host: ip, path: "/", port: serverPort }, function (json) {
        var isError = json.error != undefined ? json.error == "true" : false;
        if (isError) {
            res.send({ result: { code: 2, msg: "Failed to retrieve server info JSON" } });
            return;
        }

        var serverGamePort = json.port || 11774;

        var gamePortIsOpen = true; // todo: check if game port is accessible
        if (!gamePortIsOpen) {
            res.send({ result: { code: 2, msg: "Failed to contact game server, are the ports open and forwarded correctly?" } });
            return;
        }

        // add ip to our servers set, if it already exists then it'll silently fail
        client.sadd("servers", uri); 

        // add/set the ip/port and current time to the db
        client.hmset(uri + ":info", { "lastUpdate": Math.floor(Date.now() / 1000) });
        //client.set(uri, Math.floor(Date.now() / 1000));

        res.send({ result: { code: 0, msg: "OK" } });
    });
});

app.get("/list", function (req, res) {
    var returnData = { listVersion: 1, result: { code: 0, msg: "OK", servers: [] } };
    client.smembers("servers", function (err, result) {
        if (!result || result.length <= 0) {
            returnData.result.code = 1;
            returnData.result.msg = "No servers available";
            return res.send(returnData);
        }

        result.forEach(function (uri) {
            client.hgetall(uri + ":info", function (err, obj) {
                var currentTime = Math.floor(Date.now() / 1000);
                var lastUpdate = parseInt(obj.lastUpdate);
                if (currentTime - lastUpdate < MAXIMUM_TIME_BEFORE_SERVER_PRONOUNCED_DEAD)
                    returnData.result.servers.push(uri);
            });
        });

        return res.send(returnData);
    });
});

http.createServer(app).listen(process.env.PORT || 8080, function () {
    console.log('Listening on port ' + (process.env.PORT || 8080));
});