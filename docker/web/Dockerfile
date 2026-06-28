# syntax=docker/dockerfile:1.7
FROM node:24-slim AS build
WORKDIR /app
ENV CI=true PORT=3000 BASE_PATH=/
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
 && apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/GabABle/TradingVue.git .
RUN pnpm install --no-frozen-lockfile --prod=false \
 && NODE_ENV=production pnpm --filter @workspace/trading-chart run build

FROM nginx:alpine
COPY --from=build /app/artifacts/trading-chart/dist/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
