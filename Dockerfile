# --- Image de production ---
FROM node:22-alpine

# Curl pour le healthcheck
RUN apk add --no-cache curl

ENV NODE_ENV=production
WORKDIR /app

# Dépendances (couche cachée tant que package*.json ne change pas)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Code de l'application
COPY . .

# Les données (config + médias) vivent dans un volume
ENV DATA_DIR=/data
RUN mkdir -p /data/uploads
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:3000/healthz || exit 1

CMD ["node", "server.js"]
