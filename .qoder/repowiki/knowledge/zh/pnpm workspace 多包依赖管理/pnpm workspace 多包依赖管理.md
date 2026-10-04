---
kind: dependency_management
name: pnpm workspace 多包依赖管理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - apps/server/package.json
    - apps/web/package.json
    - packages/shared/package.json
---

## 1. 使用的系统/方案

仓库采用 **pnpm workspace** 作为 Monorepo 的依赖管理与构建编排工具，根 `package.json` 通过 `packageManager: "pnpm@10.33.2"` 与 `engines.node >= 22` 锁定 pnpm 与 Node 版本；所有第三方依赖统一声明在各子包的 `package.json` 中，并通过 `pnpm-lock.yaml`（根目录存在）进行版本锁定。未使用 vendoring、私有 npm registry 或 `GOPRIVATE` 等机制。

## 2. 关键文件

- `package.json`：根工作区入口，定义跨包脚本（`build`、`typecheck`、`test:e2e:*`、`dev`、`setup`），通过 `pnpm -r` / `pnpm --filter` 调度各子包。
- `pnpm-workspace.yaml`：声明 workspace 成员为 `apps/*` 与 `packages/*`，并启用 `onlyBuiltDependencies` 仅对 `@nestjs/core`、`@prisma/engines`、`esbuild`、`prisma` 执行原生编译，减少安装体积。
- `pnpm-lock.yaml`：全局锁文件，冻结所有依赖树版本。
- `apps/server/package.json`：NestJS 后端包 `@skill-hub/server`，依赖 NestJS 11、Prisma 7、Jest、Supertest 等。
- `apps/web/package.json`：React/Vite 前端包 `@skill-hub/web`，依赖 React 19、Ant Design 6、Vite 7、Playwright。
- `packages/shared/package.json`：共享库 `@skill-hub/shared`，通过 `tsup` 同时输出 ESM/CJS 与类型声明，并以 `exports` 字段区分 `import`/`require` 入口。
- `scripts/*.mjs`：Node 脚本（`dev.mjs`、`setup.mjs`、`dev-db.mjs`、`verify-docker.mjs`）由根脚本调用，不引入额外依赖。

## 3. 架构与约定

- **Monorepo 结构**：`apps/` 下放置可独立部署的应用（server、web），`packages/` 下放置被应用引用的内部库（shared）。workspace 成员仅匹配这两类目录。
- **内部包引用**：应用通过 `"@skill-hub/shared": "workspace:*"` 引用共享库，pnpm 会在工作区内解析该协议，无需发布到 npm registry。
- **版本策略**：所有第三方依赖均使用 `^` 语义化版本范围（如 `"react": "^19.3.0"`、`"@nestjs/core": "^11.1.0"`），实际锁定版本由 `pnpm-lock.yaml` 决定；TypeScript 在 server、web、shared 三处统一使用 `~5.9.3` 精确锁定主版本。
- **构建产物隔离**：每个包各自维护自己的 `dist/` 与 `node_modules/`，根目录不存在共享的 `node_modules`（pnpm 默认 hoist 行为受 workspace 控制）。
- **原生依赖优化**：`pnpm-workspace.yaml` 中的 `onlyBuiltDependencies` 白名单确保只有 NestJS、Prisma、esbuild 等需要 C++ 编译的包触发原生构建，其余纯 JS 包跳过编译步骤。
- **Docker 层复用**：`deploy/server.Dockerfile` 与 `deploy/web.Dockerfile` 基于各自应用的 `dist/` 产物构建镜像，依赖安装发生在镜像构建阶段而非运行时。

## 4. 约定与约束

- **包管理器锁定**：根 `package.json` 的 `packageManager` 字段强制使用 pnpm 10.33.2；Node 版本要求 `>=22`（`engines.node`）。
- **Workspace 成员边界**：仅 `apps/*` 与 `packages/*` 会被 pnpm 识别为工作区包，其他目录（如 `scripts/`、`examples/`、`docs/`）不参与依赖解析。
- **内部包协议**：跨包引用统一使用 `workspace:*` 协议（见 `@skill-hub/server` 与 `@skill-hub/web` 对 `@skill-hub/shared` 的引用），禁止直接写版本号。
- **共享库导出契约**：`packages/shared` 通过 `exports` 字段显式声明 ESM (`import`) 与 CommonJS (`require`) 两种入口及对应 `.d.ts`/`.d.mts` 类型路径，消费者按模块格式自动选择。
- **构建前钩子**：server 包通过 `prebuild: "prisma generate"` 与 `typecheck` 脚本中的 `prisma generate` 保证 Prisma Client 在编译前生成；web 包在 `typecheck` 中先运行 `pnpm check:tables` 再 `tsc --noEmit`。
- **无私有注册表配置**：仓库未发现 `.npmrc`、`.pnpmrc`、`registry` 或 `GOPRIVATE` 等私有源配置，依赖全部来自公共 npm registry。
- **无 vendoring**：未发现 vendor 目录或类似 Go modules 的本地依赖复制策略，所有第三方代码通过 pnpm 安装到各包的 `node_modules` 中。