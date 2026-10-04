# Skill Hub 演示版

从 `new-dsh-ms` 的 `skill-hub-t11` 分支、提交 `5a175705efea68fd77e873f9fc1bdefd56845566` 复制网页 Skill Hub，保留真实上传、审核、多版本、分类、可见范围、上下架和下载。使用 React + Ant Design、NestJS、Prisma 和 PostgreSQL，文件保存在独立私有目录。

## 启动

需要 Node.js 22+、pnpm（项目固定 10.33.2）和运行中的 Docker。

```bash
pnpm install
pnpm setup
pnpm dev
```

打开 http://localhost:5175 。`setup` 仅在缺失时创建本地 `.env`，启动独立 PostgreSQL、构建、迁移并幂等初始化演示数据。重复运行不会重置 Skill 或账号。数据库默认端口 5434，API 3001；不会连接源项目的数据库。

| 角色 | 用户名 | 密码 |
|---|---|---|
| 超管 | root | admin |
| 租户管理员 | 15168466666 | test |
| 普通用户 | 15168488888 | test |

登录页点账号卡片可填入用户名和密码，再点登录。不要求改密。账号固定，仅用于本地演示；没有注册、用户/员工/部门管理、OAuth 或外部客户端接口。

演示团队包含根部门、研发部、运营部。普通用户属于研发部。身份、团队和权限由服务端确定。超管可查看、下载和治理所有 Skill，但不执行租户内上传和审核。

## 演示流程

1. 普通用户登录，进入「我的 Skill」或「Skill」，上传 `examples/hello-skill` 文件夹（也支持拖入文件夹或 ZIP），版本填 `1.0.0`，提交审核。
2. 复制审核链接。退出，使用租户管理员登录；可从链接或「审核」进入，检查 SKILL.md、文件树和内容，执行通过或驳回。
3. 如驳回，普通用户在「我的 Skill」查看原因，重新上传内容并提交；管理员通过后，目录中可见并能下载。
4. 修改示例内容，以 `1.0.1` 上传新版本，审核页可查看文件差异。旧的正式版本在审核期间仍可下载。
5. 管理员可维护分类、调整部门/员工/私有可见性，或直接上传正式版本。超管可下架、上架和删除 Skill。

初始不灌入 Skill，避免混淆实际上传结果。示例内容仅在手动上传后进入数据库。

## Docker 一键运行

```bash
docker compose up -d --build --wait
```

打开 http://localhost:8081 。容器启动自动迁移并初始化账号；数据库和私有包使用独立命名卷。正常停止/启动会保留数据。不要使用 `down -v`，除非确实要删除演示数据。

## 配置

- 开发 API：`apps/server/.env`，模板为同目录 `.env.example`。
- 修改数据库映射端口：设置根目录 `.env` 的 `DB_PORT`，同时调整 API 的 `DATABASE_URL` 和测试用 `TEST_DATABASE_URL`。
- 修改 API 端口：设置 `PORT`，并为网页设置 `API_TARGET=http://localhost:端口`。
- 修改网页端口：`WEB_PORT=5176 pnpm dev`。
- 修改 Docker 网页端口：根目录 `.env` 的 `HTTP_PORT`。
- 私有包目录由 `PRIVATE_UPLOAD_DIR` 控制，默认在 `apps/server/uploads-private`。包不通过静态目录公开。

## 检查与测试

```bash
pnpm typecheck
pnpm build
pnpm test:e2e:api
pnpm --filter @skill-hub/web exec playwright install chromium
pnpm test:e2e:web
```

测试使用专用 `skill_hub_demo_test` 数据库和独立临时文件目录，不操作开发数据。重置工具拒绝名称不以 `_test` 结尾的数据库。API 测试用数据库会话构造额外角色覆盖复杂可见性，不在应用中增加测试登录入口。

服务端仅提供 `/api/auth/login`（请求字段 `phone`、`password`）、`/api/auth/me`、`/api/auth/logout` 三个登录接口。保留网页 Skill API 和超管只读租户列表。Cookie 为 `skill_hub_demo_sid`，数据库保存随机会话的 SHA-256 摘要。
