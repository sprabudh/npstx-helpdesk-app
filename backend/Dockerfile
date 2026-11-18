# Build context: repository root (needs db/seed).
FROM node:20.18.1-alpine AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20.18.1-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/package.json ./
COPY db/seed /app/db/seed
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
# Migrations are idempotent; the seed loads only when the database is empty (--if-empty).
CMD ["sh", "-c", "npm run db:migrate:prod && node dist/seed/seed.cli.js --if-empty && node dist/main.js"]
