FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run compile
RUN npm prune --omit=dev

CMD ["npm", "run", "railway:start"]
