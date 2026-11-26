FROM node:22-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

COPY service/package*.json ./
RUN npm install --omit=dev

COPY service/src/ ./src/
COPY service/migrations/ ./migrations/
COPY cli/ ./cli/

EXPOSE 5050

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5050/health || exit 1

CMD ["node", "src/server.js"]
