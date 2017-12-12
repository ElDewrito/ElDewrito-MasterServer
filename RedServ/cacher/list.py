import json
import multiprocessing
import urllib2

def wget(url):
    opener = urllib2.build_opener()
    if "User-Agent" in cherrypy.request.headers:
        opener.addheaders = [('User-Agent', cherrypy.request.headers["User-Agent"])]
    response = opener.open(url, timeout=0.7)
    content = response.read()
    return(content)
    
def json_wget(url):
    return(json.loads(wget(url)))
    
def update_cache(cache,url,server_list):
    if not url in cache:
        cache[url] = []
    if len(cache[url])==0:
        cache[url].append(time.time())
        cache[url].append(server_list)
    else:
        cache[url][0] = time.time()
        cache[url][1] = server_list
    return(cache)
    
def get_server_data(q,cache,url,server_list):
    cached = False
    if not url in cache:
        cache[url] = []
    if not len(cache[url])==0:
        if time.time() <= cache[url][0]+float(30):
            server_list = cache[url][1]
            cached = True
    if cached==False:
        try:
            recv_data = json_wget(url)
        except Exception,e:
            recv_data = None
            pass
        if not recv_data==None:
            if "result" in recv_data:
                if "msg" in recv_data["result"]:
                    if recv_data["result"]["msg"]=="OK":
                        for server_data in recv_data["result"]["servers"]:
                            server_list.append(server_data)
        cache = update_cache(cache,url,server_list)
    q.put((server_list,cache))
    return()

def clean_server_list(server_list,local_server_list):
    for server_data in local_server_list:
        if not server_data in server_list:
            server_list.append(server_data)
    return(server_list)
    
def index(params,site_data):
    master_servers = [
    "upstream server here"
    ]
    
    if not "cache" in site_data:
        site_data["cache"] = {}
    cache = site_data["cache"]
    
    server_list = []
    q = []
    p = []
    i = -1
    try:
        for data in master_servers:
            i += 1
            q.append(multiprocessing.Queue())
            p.append(multiprocessing.Process(target=get_server_data, args=(q[i],cache,data,server_list)))
            p[i].start()
        i = -1
        for data in master_servers:
            i += 1
            (local_server_list,local_cache) = q[i].get()
            server_list = clean_server_list(server_list,local_server_list)
            cache[data] = local_cache[data]
            p[i].join(timeout=1)
            p[i].terminate()
    finally:
        i = -1
        if not p==None:
            if len(p)>0:
                for data in p:
                    i += 1
                    p[i].join(timeout=0.5)
                    p[i].terminate()
    output = {}
    output["listVersion"] = 1
    output["result"] = {}
    output["result"]["code"] = 0
    output["result"]["msg"] = "OK"
    output["result"]["servers"] = server_list
    cherrypy.response.headers["content-type"] = "application/json"
    cherrypy.response.headers["Access-Control-Allow-Credentials"] = "true"
    cherrypy.response.headers["Access-Control-Allow-Headers"] = "Content-Type,X-Player"
    cherrypy.response.headers["Access-Control-Allow-Methods"] = "POST, GET"
    cherrypy.response.headers["Access-Control-Allow-Origin"] = "*"
    return(json.dumps(output))

datareturned,response = (index(params,site_data),200)
