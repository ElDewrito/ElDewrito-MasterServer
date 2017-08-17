# Set the base image to Ubuntu
FROM ubuntu:14.04

# File Author / Maintainer
MAINTAINER Quinton Marchi

# Install Hiawatha
RUN apt-get update && apt-get install libxslt1.1 wget -y
RUN wget https://mirror.tuxhelp.org/debian/pool/main/h/hiawatha/hiawatha_9.13_amd64.deb && dpkg -i hiawatha_9.13_amd64.deb

# Remove the default Hiawatha configuration file
RUN rm -v /etc/hiawatha/hiawatha.conf

# Copy a configuration file from the current directory
ADD hiawatha.conf /etc/hiawatha/

# Expose ports
EXPOSE 80
# Saved for later use
# EXPOSE 443

# Set the default command to execute when creating a new container
CMD service hiawatha start
