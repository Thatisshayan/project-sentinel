FROM node:20-alpine

# Install Python and pip for Aider
RUN apk add --no-cache python3 py3-pip git

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Install Aider
RUN pip3 install aider-install --break-system-packages \
  && aider-install \
  || pip3 install aider-chat --break-system-packages

ENV PATH="/root/.local/bin:${PATH}"

# Limit Node.js heap to prevent OOM kills (Railway default ~512MB)
ENV NODE_OPTIONS="--max-old-space-size=256"

COPY src/ ./src/

RUN addgroup -S sentinel && adduser -S sentinel -G sentinel
USER sentinel

EXPOSE 3000

HEALTHCHECK \
  --interval=60s \
  --timeout=30s \
  --start-period=60s \
  --retries=5 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1));"

CMD ["node", "src/index.js"]
