FROM node:20.18.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Portal mode (docker-compose.portal.yml): API behind the gateway at /api/helpdesk, sign-in on the portal.
ARG VITE_PORTAL_MODE=false
ARG VITE_API_BASE=/api
ARG VITE_PORTAL_URL=
ENV VITE_PORTAL_MODE=$VITE_PORTAL_MODE VITE_API_BASE=$VITE_API_BASE VITE_PORTAL_URL=$VITE_PORTAL_URL
RUN npm run build

FROM nginx:1.27.3-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
