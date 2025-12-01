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

EXPOSE 3002

CMD ["node", "server/index.js"]
