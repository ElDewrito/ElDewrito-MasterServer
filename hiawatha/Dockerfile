# Set the base image to Ubuntu
FROM ubuntu

# File Author / Maintainer
MAINTAINER Quinton Marchi

# Install Hiawatha

# Add application repository URL to the default sources
RUN gpg --ignore-time-conflict --no-options --no-default-keyring --homedir /tmp/tmp.Bp6FWxXEAB --no-auto-check-trustdb --trust-model always --keyring /etc/apt/trusted.gpg --primary-keyring /etc/apt/trusted.gpg --keyring /etc/apt/trusted.gpg.d/ambrop7-badvpn.gpg --keyring /etc/apt/trusted.gpg.d/mamarley-quassel.gpg --recv-keys --keyserver keys.gnupg.net 79AF54A9
RUN echo 'deb http://mirror.tuxhelp.org/debian/ squeeze main' >> /etc/apt/sources.list

# Update the repository
RUN apt-get update

# Install necessary tools
RUN apt-get install -y nano wget dialog net-tools

# Download and Install Hiawatha
RUN apt-get install -y hiawatha

# Remove the default Nginx configuration file
RUN rm -v /etc/hiawatha/hiawatha.conf

# Copy a configuration file from the current directory
ADD hiawatha.conf /etc/hiawatha/

# Expose ports
EXPOSE 80
# Saved for later use
# EXPOSE 443

# Set the default command to execute when creating a new container
CMD service hiawatha start
