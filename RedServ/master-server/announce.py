import json
import time
import urllib2

def wget(url):
    opener = urllib2.build_opener()
    response = opener.open(url, timeout=1)
    content = response.read()
    return(content)
    
def json_wget(url):
    return(json.loads(wget(url)))

def data_json(code,msg):
    output = {}
    output["result"] = {}
    output["result"]["code"] = code
    output["result"]["msg"] = msg
    return(json.dumps(output))

def index(params,site_data):
    if not 'server_list' in site_data:
        site_data['server_list'] = []
    if not 'server_list_timing' in site_data:
        site_data['server_list_timing'] = {}
    cherrypy.response.headers["content-type"] = "application/json"
    if not "port" in params:
        return(data_json(1,"Invalid parameters, valid parameters are 'port' (int) and 'shutdown' (bool)"))
    else:
        if not "shutdown" in params:
            params["shutdown"] = False
        else:
            if params["shutdown"].lower()=="true":
                params["shutdown"] = True
            elif params["shutdown"].lower()=="false":
                params["shutdown"] = False
        try:
            port = int(params["port"])
        except Exception,e:
            return(data_json(4,"Invalid port. A valid port is in the range 1024-65535."))
        if port>65535 or port<1024:
            return(data_json(4,"Server returned invalid port. A valid port is in the range 1024-65535."))
        if "x-forwarded-for" in cherrypy.request.headers:
            ip = cherrypy.request.headers["x-forwarded-for"]
        else:
            ip = cherrypy.request.remote.ip
        if len(ip.split("."))==4:
            failed_ip = False
            for data in ip.split("."):
                try:
                    int(data)
                    if int(data)>255 or int(data)<0:
                        int("a")
                except Exception,e:
                    failed_ip = True
        else:
            failed_ip = True
        if failed_ip==True:
            return(data_json(5,"Invalid IP address."))
        uri = "http://"+str(ip)+":"+str(port)
        try:
            game_server_json = json_wget(uri)
        except Exception,e:
            return(data_json(2,"Failed to retrieve server info JSON from " + uri))
        
        if int(game_server_json["port"])>66535 or int(game_server_json["port"])<1024:
            return(data_json(4,"Server returned invalid port. A valid port is in the range 1024-65535."))
        
        gameportisopen = True
        if gameportisopen==False:
            return(data_json(3,"Failed to contact game server, are the ports open and forwarded correctly?"))
            
        if params["shutdown"]==True:
            if str(ip)+":"+str(port) in site_data['server_list']:
                del site_data['server_list_timing'][str(ip)+":"+str(port)]
                site_data['server_list'].remove(str(ip)+":"+str(port))
            return(data_json(0,"Removed server from list"))
        
        
        if not str(ip)+":"+str(port) in site_data['server_list']:
            site_data['server_list'].append(str(ip)+":"+str(port))
        site_data['server_list_timing'][str(ip)+":"+str(port)] = time.time()
        return(data_json(0,"Added server to list"))
                
                
datareturned,response = (index(params,site_data),200)