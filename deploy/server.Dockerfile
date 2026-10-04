# Prisma 按 openssl 版本挑选 schema-engine，构建与运行阶段必须一致
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @skill-hub/server...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @skill-hub/shared build \
 && pnpm --filter @skill-hub/server build \
 && pnpm --filter @skill-hub/server deploy --prod --legacy /out

FROM base
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
EXPOSE 3000
# 启动前迁移并幂等初始化演示数据
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/main.js"]
