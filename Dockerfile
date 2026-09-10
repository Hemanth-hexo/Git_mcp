FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY lib ./lib
COPY tools ./tools
COPY server-http.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server-http.js"]
