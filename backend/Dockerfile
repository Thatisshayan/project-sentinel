FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY src/ ./src/

RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
USER sentinel

EXPOSE 3000

HEALTHCHECK \
  --interval=30s \
  --timeout=10s \
  --start-period=20s \
  --retries=3 \
  CMD node -e "\
    require('http').get('http://localhost:3000/health', (r) => {\
      process.exit(r.statusCode === 200 ? 0 : 1);\
    }).on('error', () => process.exit(1));"

CMD ["node", "src/index.js"]
