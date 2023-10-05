FROM ubuntu:20.04
ARG stage_name
ENV STAGE=$stage_name

# Create app directory
WORKDIR /home/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN apt-get clean && apt-get update
RUN apt-get install -y curl
#RUN apt-get -y install build-essential
RUN apt-get -y install g++ cmake
RUN curl -fsSL https://deb.nodesource.com/setup_14.x | bash -
RUN apt-get install -y nodejs
#RUN apt-get install -y python

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

#start prod server
CMD ["node", "src/jobs/claims/claims-file-processor.js", "test"]