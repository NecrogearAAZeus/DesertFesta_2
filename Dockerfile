FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY games ./games
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
