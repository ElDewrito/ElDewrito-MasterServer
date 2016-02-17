import json
import time
    
def index(params,site_data):
    if not 'server_list' in site_data:
        site_data['server_list'] = []
    removal_servers = []
    for data in site_data['server_list']:
        if data in site_data['server_list_timing']:
            if time.time() >= site_data['server_list_timing'][data]+float(5*60):
                removal_servers.append(data)
    for rem_data in removal_servers:
        del site_data['server_list_timing'][rem_data]
        site_data['server_list'].remove(rem_data)
    output = {}
    output["listVersion"] = 1
    output["result"] = {}
    output["result"]["code"] = 0
    output["result"]["msg"] = "OK"
    output["result"]["servers"] = site_data['server_list']
    cherrypy.response.headers["content-type"] = "application/json"
    cherrypy.response.headers["Access-Control-Allow-Credentials"] = "true"
    cherrypy.response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    cherrypy.response.headers["Access-Control-Allow-Methods"] = "POST, GET"
    cherrypy.response.headers["Access-Control-Allow-Origin"] = "*"
    return(json.dumps(output))

datareturned,response = (index(params,site_data),200)