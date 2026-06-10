FROM node:22-slim

WORKDIR /app

# Install OpenCode globally
RUN npm install -g opencode@1.17.0

COPY package.json package-lock.json ./
RUN npm ci --production

COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]
