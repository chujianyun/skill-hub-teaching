---
kind: build_system
name: pnpm monorepo + Docker Compose 构建与部署体系
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - scripts/dev.mjs
    - scripts/setup.mjs
    - apps/server/package.json
    - apps/server/nest-cli.json
    - apps/web/package.json
    - apps/web/vite.config.ts
    - packages/shared/package.json
    - deploy/server.Dockerfile
    - deploy/web.Dockerfile
    - deploy/Caddyfile
    - docker-compose.yml
---

## 1. 使用的系统与工具

- **包管理器**: pnpm workspace（根 `package.json` 锁定 `packageManager: "pnpm@10.33.2"`，`engines.node >= 22`），通过 `pnpm-workspace.yaml` 声明 `apps/*` 与 `packages/*` 两个工作区。
- **运行时**: Node.js 22（Dockerfile 使用 `node:22-bookworm-slim`）；生产 Web 静态资源由 Caddy 2 (`caddy:2-alpine`) 托管。
- **后端构建**: NestJS CLI (`nest build`)，输出到 `dist/`；Prisma 在 `prebuild` 钩子中生成客户端。
- **前端构建**: Vite 7 + React 插件，TypeScript 类型检查通过 `tsc --noEmit` 前置执行。
- **共享库构建**: tsup 以 ESM + CJS 双格式输出，并同步生成 `.d.ts`。
- **容器编排**: Docker Compose（`docker-compose.yml` / `docker-compose.dev.yml`）编排 PostgreSQL 17、server、web 三服务。
- **测试**: Jest（后端 e2e，`--runInBand`）、Playwright（前端 e2e）。

## 2. 关键文件

- 根级入口: `package.json`、`pnpm-workspace.yaml`
- 应用脚本: `scripts/dev.mjs`、`scripts/setup.mjs`
- 容器镜像: `deploy/server.Dockerfile`、`deploy/web.Dockerfile`、`deploy/Caddyfile`
- 编排配置: `docker-compose.yml`
- 各模块构建入口: `apps/server/package.json`、`apps/web/package.json`、`packages/shared/package.json`
- 构建配置: `apps/server/nest-cli.json`、`apps/web/vite.config.ts`

## 3. 架构与约定

### 3.1 Workspace 依赖图

```text
@skill-hub/shared (tsup) ← @skill-hub/server (NestJS)
                          ← @skill-hub/web (Vite)
```

`pnpm-workspace.yaml` 通过 `onlyBuiltDependencies` 仅允许 `@nestjs/core`、`@prisma/engines`、`esbuild`、`prisma` 安装原生依赖，减少无关 native 模块的编译开销。

### 3.2 顶层脚本

- `pnpm build` → `pnpm -r build`：按 workspace 顺序触发每个包的 `build` 脚本。
- `pnpm typecheck` → `pnpm -r typecheck`：统一类型检查。
- `pnpm test:e2e:api` / `test:e2e:web`：分别通过 `--filter` 调用子包脚本。
- `pnpm setup`：`scripts/setup.mjs` 依次执行 `dev:db` → `build` → `db:deploy` → `db:seed`，是本地初始化的标准流程。
- `pnpm dev`：`scripts/dev.mjs` 并行 spawn `pnpm --filter @skill-hub/server dev` 与 `pnpm --filter @skill-hub/web dev`，并在 SIGINT/SIGTERM 时向所有子进程转发信号。

### 3.3 后端构建链

`apps/server/package.json`:
- `prebuild`: `prisma generate`（确保 `@prisma/client` 与 schema 一致）
- `build`: `nest build`（受 `nest-cli.json` 控制，`deleteOutDir: true`）
- `typecheck`: `prisma generate && tsc --noEmit`
- `test:e2e`: `jest --config test/jest-e2e.json --runInBand`

Docker 构建 (`deploy/server.Dockerfile`) 分两阶段：
1. `build` 阶段：复制 lock/workspace 清单后 `pnpm install --frozen-lockfile --filter @skill-hub/server...`，再依次 `pnpm --filter @skill-hub/shared build` → `pnpm --filter @skill-hub/server build` → `pnpm --filter @skill-hub/server deploy --prod --legacy /out`。
2. 运行阶段：`CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/main.js"]`，启动前自动迁移并幂等初始化演示数据。

注释明确约束：**Prisma 按 openssl 版本挑选 schema-engine，构建与运行阶段必须一致**，因此 base 镜像先安装 `openssl`。

### 3.4 前端构建链

`apps/web/package.json`:
- `build`: `tsc --noEmit && vite build`（类型检查失败则中止打包）
- `typecheck`: 先跑 `pnpm check:tables`（`scripts/check-tables.mjs --self-test`），再做 `tsc --noEmit`

Docker 构建 (`deploy/web.Dockerfile`) 同样分两阶段：build 阶段产出 `apps/web/dist`，运行阶段用 `caddy:2-alpine` 托管，Caddyfile 将 `/api/*` 反向代理到 `server:3000`，`/assets/*` 设置 `Cache-Control: public, max-age=31536000, immutable`，其余路径走 SPA fallback 到 `/index.html`。

### 3.5 共享库发布契约

`packages/shared/package.json` 暴露 `main` / `module` / `types` 以及 `exports` 字段，同时提供 ESM (`dist/index.mjs`, `dist/index.d.mts`) 与 CJS (`dist/index.js`, `dist/index.d.ts`) 入口，供 NestJS 与 Vite 共同消费。

### 3.6 开发环境

- `vite.config.ts` 默认监听 `WEB_PORT`（默认 5175），并将 `/api` 代理到 `API_TARGET`（默认 `http://localhost:3001`）。
- `docker-compose.yml` 中 server 暴露 `PORT=3000`，web 映射 `127.0.0.1:${HTTP_PORT:-8081}:80`，PostgreSQL 使用 `postgres:17-alpine`，并通过 `pg_isready` 健康检查。
- service 间依赖：`server` 依赖 `postgres` healthy，`web` 依赖 `server` healthy。

## 4. 约定与约束

- **Node 版本**：根 `package.json` 的 `engines.node >= 22` 与所有 Dockerfile 使用 `node:22-bookworm-slim` 保持一致。
- **依赖锁定**：Docker 构建一律使用 `pnpm install --frozen-lockfile`，禁止锁外变更。
- **workspace 过滤**：所有跨包操作通过 `pnpm --filter @skill-hub/<pkg>` 精确限定范围，避免全量重建。
- **构建产物目录**：server 通过 NestJS `deploy --prod --legacy /out` 输出到 `/out`，web 输出到 `apps/web/dist`，二者在 Dockerfile 中被 COPY 进最终镜像。
- **数据库迁移时机**：server 镜像启动命令强制先执行 `prisma migrate deploy`，保证容器首次启动即完成 schema 对齐。
- **Prisma 原生引擎一致性**：`deploy/server.Dockerfile` 首行注释显式要求构建与运行阶段使用相同 OpenSSL 版本，否则 Prisma schema-engine 可能不匹配。
- **只读构建缓存**：`pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 白名单限制原生模块安装范围，缩小构建面。
- **安全头**：Caddyfile 统一添加 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、移除 `Server` 响应头。
- **上传大小限制**：Caddyfile 对 `/api/*` 设置 `request_body.max_size 26MB`，与后端存储能力对齐。
- **资产缓存策略**：`/assets/*` 返回 `Cache-Control: public, max-age=31536000, immutable`，其他页面资源为 `no-cache` 并以 try_files 回退到 `/index.html`。
- **测试隔离**：后端 e2e 使用 `--runInBand` 串行执行，避免并发访问同一测试数据库。