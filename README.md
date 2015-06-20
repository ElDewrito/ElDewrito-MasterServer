# A sample master server implementation for ElDewrito

This implements all the features expected in an ElDewrito master server, in a stable, scalable, production-ready way.

I mainly only call it a sample as others can use this to see how endpoints should function, in case they want to implement their own master server.

However it'll also work fine with next to no changes needed, the master server I'll be operating will run on the same code as this git.

Installation (with Docker)
=============
- Install Docker
- Install Docker-compose
- Change to the main directory of this repo (with the docker-compose.yml file)
- Run "docker-compose up"
- Go have a coffee while it sets up the containers, once it's done you should be able to access the master server at port 80.

This sets up and installs Redis, nginx and node.js automatically, each one running inside their own Docker container.

By default it also sets up three separate instances of the main node.js application, with the nginx server set up to load balance between them.
These instances are all linked to the main Redis database and share the same server list with each other.

Installation (without Docker)
=============================
While Docker is the recommended way to set up the master server there are various ways you can set it up without using separate Docker containers.

- First install Redis, this is required by the master server.
- Also install node.js and NPM
- Once they've been installed change to the node directory and run "npm install"
- Sit back and wait for the dependencies to install
- Run "node index.js" to start the master
- The master can now be accessed at port 8080

I recommend you setup a nginx forward proxy on port 80 to forward to the node.js application on port 8080, but if you don't want to you can just edit the index.js to run the node.js app on port 80 instead. (make sure to set isRunningBehindProxy to false if you do this!)

Configuration
=============
You can edit various options in the config files inside each folder, node/index.js also has some options near the top of the file.

You should set these config options before running "docker-compose up" for the first time, as changing things inside a Docker container can be troublesome.

Note that ElDewrito is set up to re-announce to each master it knows about every 2.5 minutes, setting the serverContactTimeLimit to less than that will cause problems!