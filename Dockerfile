# Build: dados, cliente (Vite) e servidor (esbuild, autossuficiente)
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# Runtime: só o servidor empacotado e o cliente compilado
FROM node:22-slim
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=8080 APP_VERSION=$APP_VERSION
COPY --from=build /app/packages/server/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "dist/server.mjs"]
