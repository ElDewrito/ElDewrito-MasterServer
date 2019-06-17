/*
DECENTRALIZED MASTER SERVER CONCEPT BY WARM_BEER (15-06-2019)
VERSION 3.2 (17-06-2019)
BASED ON https://github.com/ElDewrito/ElDewrito-MasterServer BY: medsouz
Clients would have to sync with one seeder on start to get an entire seeder_list to choose the best seeder from on next start.
/list and /announcing works just like the original master server.
*/

// Only the first identifier checks if another seeder is compatible
const VERSION = 3.2;

// Text sent to anyone who happens to contact the master server outside of ED
const welcomeText = "<h1>Hi there.</h1>" +
    "<p>This is a running prototype of a master server node for ElDewrito.</p>";

// Set your IP if you are running ElDewrito servers with the same IP
const MY_IP = "0.0.0.0";

// Are you running behind a proxy?
const isRunningBehindProxy = false;

// The default port number for this application PORT FORWARD THIS PORT
const appPortNumber = 8080;

// If a server hasn't contacted us in this many minutes it's assumed to be offline
const serverContactTimeLimit = 10;

// Interval to refresh the cached_server_list in seconds
const UPDATE_SERVER_LIST_INTERVAL = 60;

// Interval to sync with other seeders in seconds
const SYNC_WITH_SEEDERS_INTERVAL = 240;

// Random server announce check when syncing
const RANDOM_SAMPLE_CHANCE = 0.1;
const MAX_FALSE_SERVERS = 2;

// Max amount of new seeders checked (added if checked positive) when syncing with another seeder
const MAX_SEEDER_CHECK = 5;

// Needed to generate key
const CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Initial seeder
const INITIAL_SEEDER = "thebeerkeg.net/ms";

// End of configurable options, only edit below if you know what you're doing!
const express = require('express'),
    http = require('http'),
    request = require('request'),
    fs = require("fs");

// Don't change this or no one will sync with you
const KEY_LENGTH = 32;

let seeder_list;

let server_announce_list = [];

let server_list = [];

let cached_server_list = [];

let inactive_seeder_list = [];

let server_keys = [];

let app = express();

function get_seeders_from_file() {
    seeder_list = JSON.parse(fs.readFileSync('seeders.txt'));
    if (seeder_list.indexOf(INITIAL_SEEDER) < 0) {
        seeder_list.push(INITIAL_SEEDER);
    }
}

function save_seeders_file() {
    if (seeder_list !== undefined) {
        fs.writeFile('seeders.txt', JSON.stringify(seeder_list), (err) => {
            if (err) throw err;
        })
    }
}

function cleanup_server_keys() {
    let start = server_keys.length - server_announce_list.length;
    server_keys = server_keys.splice(start);
}

function sync_with_seeders() {
    for (let seeder in seeder_list) {
        if (inactive_seeder_list.indexOf(seeder_list[seeder]) < 0) {
            console.log("Checking seeder: " + seeder_list[seeder]);
            synchronize(seeder_list[seeder]);
        }
    }
    console.log("Finished syncing, saving seeders file");
    save_seeders_file();
    cleanup_server_keys();
    update_server_list();
}

function add_seeder(seeder) {
    if(seeder_list.indexOf(seeder) < 0) {
        console.log("Adding seeder: " + seeder);
        seeder_list.push(seeder);
        //console.log("New seeder list: " + seeder_list);
    }
}

function remove_seeder(seeder) {
    if(seeder_list.indexOf(seeder) > -1) {
        seeder_list = seeder_list.splice(seeder_list.indexOf(seeder), 1);
        console.log("Removed seeder: " + seeder);
    }
}

function server_announce_list_add(server) {
    if(!key_valid(server.key) || server.key === undefined) {return;}
    if (server_keys.indexOf(server.key) < 0) {
        server_announce_list.push(server);
        server_keys.push(server.key);
    } else {
        //console.log("Timestamp already added");
    }
}

function version_check(seeder_version) {
    return (Math.floor(seeder_version) === Math.floor(VERSION));
}

function synchronize(seeder) {
    jsonGet({
        uri: "http://" + seeder + "/sync?port=" + appPortNumber,
        timeout: 10 * 1000
    }, function(json) {
        let isError = json.error !== undefined ? json.error === "true" : false;

        if (isError) {
            console.log("Inactive seeder: " + seeder);
            inactive_seeder_list.push(seeder);
            remove_seeder(seeder);
            //remove_seeder(seeder);
            return;
        }

        let seeder_version = json.seederVersion !== undefined ? json.seederVersion : 0;

        if (!version_check(seeder_version)) {
            console.log("Different version seeder: " + seeder, "seeder is using V" + seeder_version, "while you are on V" + VERSION);
            inactive_seeder_list.push(seeder);
            remove_seeder(seeder);
            //remove_seeder(seeder);
            return;
        }

        synchronize_server_announce_list(json.result.server_announce_list);
        synchronize_seeder_list(json.result.seeder_list);
    });
}

function synchronize_seeder_list(new_seeder_list) {
    let seeders_checked = 0;
    for (let new_seeder in new_seeder_list) {
        let seeder = new_seeder_list[new_seeder];
        if (seeders_checked > MAX_SEEDER_CHECK) {break;}
        if (seeder_list.indexOf(seeder) > -1) {continue;}
        if (check_seeder(seeder)) {
            add_seeder(seeder);
        }
        seeders_checked++;
    }
}

function check_max_servers(false_servers) {
    return (false_servers < MAX_FALSE_SERVERS);
}

function synchronize_server_announce_list(new_server_announce_list) {
    let false_servers = 0;
    for(let new_server_announce in new_server_announce_list) {
        if (!check_max_servers(false_servers)) {
            console.log("Stopped syncing, too many false servers!");
            break;
        }

        let server = {
            key: new_server_announce_list[new_server_announce].key,
            ip: new_server_announce_list[new_server_announce].ip,
            timestamp: new_server_announce_list[new_server_announce].timestamp
        };

        if (!!server.ip && !!server.timestamp && !!server.key) {
            if (server_keys.indexOf(server.key) > -1) {continue;}
            if(Math.random() < RANDOM_SAMPLE_CHANCE) {
                console.log("Sample testing server: " + server.ip);
                if(!ping_game_server(server.ip)) {
                    false_servers++;
                    console.log(server.ip + " tested false!")
                }
            }
            server_announce_list_add(server);
        }
    }
}

function update_server_announce_list() {
    server_announce_list = server_announce_list.filter(check_last_update);
    update_server_list();
}

function update_server_list() {
    server_list = [];
    for (let announced_server in server_announce_list) {
        server_list.push(server_announce_list[announced_server].ip);
    }

    server_list = server_list.filter(distinct);
    cached_server_list = server_list;
    //console.log("Updated server_list: " + server_list);
}

function check_last_update(server) {
    let currentTime = new Date();
    let lastUpdate = Date.parse(server.timestamp);
    let diff = (currentTime - lastUpdate);
    let diff_in_minutes = Math.round(((diff % 86400000) % 3600000) / 60000);
    //console.log("Diff in Mins for server: " + server.ip + " is " + diff_in_minutes + " mins");

    if(!(diff_in_minutes < serverContactTimeLimit)) {
        //console.log("Deleted server: " + server.ip)
    }

    return (diff_in_minutes < serverContactTimeLimit);
}

function distinct(value, index, self) {
    return self.indexOf(value) === index;
}

function generate_key(length) {
    let result = '';
    for (let i = length; i > 0; --i) result += CHARS[Math.floor(Math.random() * CHARS.length)];
    return result;
}

function key_valid(key) {
    if( /[^a-zA-Z0-9]/.test(key) || key.length !== KEY_LENGTH) {
        console.log('Key is invalid');
        return false;
    }
    return true;
}

function check_seeder(seeder) {
    let seeder_works = true;

    jsonGet({
        uri: "http://" + seeder + "/sync?port=" + appPortNumber,
        timeout: 10 * 1000
    }, function(json) {
        let isError = json.error !== undefined ? json.error === "true" : false;

        if (isError) {
            seeder_works = false;
        }

        let seeder_version = json.seederVersion !== undefined ? json.seederVersion : 0;

        if (!version_check(seeder_version)) {
            seeder_works = false;
        }

    });
    return seeder_works;
}

function ping_game_server(uri) {
    let server_works = true;

    jsonGet({
        uri: "http://" + uri + "/",
        timeout: 10 * 1000
    }, function(json) {
        let isError = json.error !== undefined ? json.error === "true" : false;
        if (isError) {
            server_works = false;
            console.log("ERROR pinging: " + uri);
        }

        let serverGamePort = +json.port;

        if (isNaN(serverGamePort) || serverGamePort < 1024 || serverGamePort > 66535) {
            console.log("Can't contact server, incorrect game port");
            server_works = false;
            console.log("ERROR port: " + uri);
        }

    });
    return server_works;
}

function jsonGet(options, callback) {
    return request(options, function(error, response, body) {
        if (error || response.statusCode !== 200) {
            return callback({
                error: "true"
            });
        }
        let data;
        try {
            data = JSON.parse(body);
        } catch (ex) {
            console.log("error contacting", options.uri, ":", ex);
            data = {
                error: "true",
                message: "Unreachable host."
            };
        }
        return callback(data);
    });
}

// Send seeder_list and server_announce_list to other seeders

app.get("/sync", function(req, res) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Credentials", true);
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    ip = ip.trim();

    if (!isRunningBehindProxy) {
        ip = req.connection.remoteAddress;
    }

    console.log("Seeder: " + ip + " synced with me.");

    if (ip === "127.0.0.1" || ip === "192.168.0.1" || ip === "192.168.1.1") {
        return res.send({
            error: true,
            result: {
                code: 6,
                msg: "You don't want to sync with yourself."
            }
        }); // This is me
    }

    console.log(req.query);

    if (!!req.query.port) {
        let port = req.query.port;
        ip = ip + ':' + port;
        add_seeder(ip);
    } else {
        console.log("No port given")
    }

    let returnData = {
        listVersion: 1,
        seederVersion: VERSION,
        result: {
            code: 0,
            msg: "OK",
            server_announce_list: server_announce_list,
            seeder_list: seeder_list
        }
    };

    return res.json(returnData);
});

app.get('/announce', function(req, res) {

    console.log("Server announcing...");

    if (!req.query.port) {
        console.log("Server announcing... but no port given");
        return res.send({
            result: {
                code: 1,
                msg: "Invalid parameters, valid parameters are 'port' (int) and 'shutdown' (bool)"
            }
        });
    }

    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    let serverPort = +req.query.port;

    if (isNaN(serverPort) || serverPort < 1024 || serverPort > 65535) {
        console.log("Server announcing... but incorrect port");
        return res.send({
            result: {
                code: 4,
                msg: "Invalid port. A valid port is in the range 1024-65535."
            }
        }); //could allow 1-65535
    }

    if (!isRunningBehindProxy) {
        ip = req.connection.remoteAddress;
    }

    ip = ip.trim();
    if(ip === "127.0.0.1" || ip === "192.168.0.1" || ip === "192.168.1.1") {
        ip = MY_IP;
    }

    if (!/^((25[0-5]|2[0-4]\d|([0-1]?\d)?\d)\.){3}(25[0-5]|2[0-4]\d|([0-1]?\d)?\d)$/.test(ip)) {
        console.log("Server announcing... but invalid IP");
        return res.send({
            result: {
                code: 5,
                msg: "Invalid IP address."
            }
        }); //unlikely
    }

    let uri = ip + ":" + serverPort;

    if(ping_game_server(uri)) {
        // add ip to our servers
        let key = generate_key(KEY_LENGTH);
        server_announce_list_add({key: key, ip: uri, timestamp: new Date().toString()});
        console.log("Added server", uri, "with key:", key);
    }
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

app.get("/list", function(req, res) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Credentials", true);
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    let returnData = {
        listVersion: 1,
        result: {
            code: 0,
            msg: "OK",
            servers: cached_server_list
        }
    };

    return res.send(returnData);
});

function setup() {
    get_seeders_from_file();
    sync_with_seeders();
    setInterval(update_server_announce_list, 1000 * UPDATE_SERVER_LIST_INTERVAL);
    setInterval(sync_with_seeders, 1000 * SYNC_WITH_SEEDERS_INTERVAL);
}

app.all("/", function(req, res) {
    res.send(welcomeText);
});

http.createServer(app).listen(appPortNumber, "0.0.0.0", function() {
    console.log('Listening on port ' + appPortNumber);
    setup();
});
