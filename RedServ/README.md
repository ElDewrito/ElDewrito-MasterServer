## RedServ

You can run a RedServ version of the node.js app if you so wish by placing the cacher and/or master-server folders into your pages directory.

When doing this make sure you follow the scheme that you set in RedServ's global config to make sure that it is served.

You'll need to edit the cacher's server list for list and announce. Please ONLY make the announce call the master-server app as the node.js app doesn't allow the cacher to function correctly.