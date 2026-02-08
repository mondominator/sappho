FROM node:18-alpine AS frontend-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Get tone binary from official image
FROM sandreas/tone:v0.2.5 AS tone

FROM node:18-alpine

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Install ffmpeg for m4b chapter extraction
RUN apk add --no-cache ffmpeg

# Copy tone binary for audiobook metadata embedding
COPY --from=tone /usr/local/bin/tone /usr/local/bin/tone

COPY package*.json ./
RUN npm install --only=production

COPY server/ ./server/
COPY --from=frontend-builder /app/client/dist ./client/dist

RUN mkdir -p /app/data/uploads /app/data/watch /app/data/audiobooks /app/data/covers

# Run as non-root user for security
RUN addgroup -g 1000 sappho && \
    adduser -D -u 1000 -G sappho sappho && \
    chown -R sappho:sappho /app /app/data
USER sappho

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http = require('http'); const port = process.env.PORT || 3002; http.get('http://localhost:' + port + '/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server/index.js"]
