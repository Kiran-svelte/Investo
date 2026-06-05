FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN node node_modules/prisma/build/index.js generate && node node_modules/typescript/bin/tsc

EXPOSE 3001

CMD ["npm", "start"]
