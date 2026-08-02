# 1. Use a Node base image
FROM node:20-alpine

# 2. Create app directory
WORKDIR /usr/src/app

# 3. Install app dependencies
# We copy package.json and package-lock.json first to cache layers
COPY package*.json ./

RUN npm install

# 4. Bundle app source
COPY . .

# 5. Build the TypeScript code (assuming you have a 'build' script)


# 6. Expose the port Fastify is listening on
EXPOSE 4000

# 7. Start the app
CMD [ "npm", "start" ]