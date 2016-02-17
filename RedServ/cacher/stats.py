import json

def data_json(code,msg):
    output = {}
    output["result"] = {}
    output["result"]["code"] = code
    output["result"]["msg"] = msg
    return(json.dumps(output))

def index(headers,params):
    cherrypy.response.headers["content-type"] = "application/json"
    return(data_json(1,"Stats are unsupported on this master server"))
datareturned,response = (index(headers,params),200)
