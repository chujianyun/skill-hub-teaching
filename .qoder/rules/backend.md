# 后端规则

适用于修改 `apps/server/**`，以及共享契约、Skill 包校验和持久化行为。所有路径相对仓库根目录。

## 接口与契约

- 沿用 NestJS Controller、Service、DTO 和现有模块划分；复用 `@skill-hub/shared` 中的契约。
- 入参校验参考 `apps/server/src/skills/skills.dto.ts`；认证与会话参考 `apps/server/src/auth/`。
- 登录接口保持 login、me、logout 三个入口；测试身份构造方式见验证规则。
- 登录请求字段保持 `phone`、`password`；随机会话令牌的 SHA-256 摘要存入数据库，不记录原始令牌。

## 租户、可见性与角色

- 租户业务查询与写入都必须限定目标租户；超管跨租户能力沿用独立的管理入口与授权检查。
- 复用 `apps/server/src/skills/skill-visibility.ts` 和 `apps/server/src/skills/skill-views.ts`，不要在每个接口重写可见性条件。
- 可见性设置作用于 Skill 的所有版本；部门范围包含下级部门，员工按当前所属部门判断。
- 部门和员工选项必须属于目标租户；保留所有者和管理员的管理能力，以及下架后普通查看者的访问限制。
- 正式版本可见性不能扩展为草稿、审核记录可见性；分别检查目录、详情、预览、历史版本及下载。
- 普通 Skill 访问中，不可见资源返回 404，可见但无管理权限返回 403；审核链接对不存在或无权查看的版本统一返回 403。不要跨入口统一错误码。
- 审核链接授权参考 `apps/server/src/skills/skill-review-links.service.ts`；链接不授予权限，`canReview` 由目标租户角色和版本状态共同决定。

## 审核与版本

- 修改流程前读取 `apps/server/src/skills/skills.service.ts`、`apps/server/src/skills/skill-reviews.service.ts` 和 `apps/server/src/skills/skill-views.ts` 中相关实现。
- 保留草稿、提交、撤回、通过、驳回、重提和审核记录之间的关联，不只修改状态标签。
- 发布路径变化时同时检查管理员直接发布与普通用户提交审核；文件差异以当前版本之前的最高正式版本为基准，审阅下载不计入下载次数。
- 状态迁移按预期旧状态进行条件更新，保留重复或并发操作的冲突检查和 409 响应。
- 需要一致提交的业务记录使用数据库事务；涉及磁盘写入时同时处理失败清理，不能假定数据库回滚会回滚文件。

## 上传与私有存储

- 包校验参考 `apps/server/src/skills/skill-package.ts` 和 `packages/shared/src/skill.ts`。
- 保留路径规范化、非法路径拒绝、文件数量与总大小限制、Skill 根目录定位和 `SKILL.md` 解析。
- 服务端独立验证文件内容，不能信任前端检查结果；不要为兼容某个样例关闭解包保护。
- 通过 `apps/server/src/storage/private-file-storage.ts` 中的 `PrivateFileStorage` 访问包，配置入口为 `PRIVATE_UPLOAD_DIR`；存储 key 不等于公开下载地址。

## 数据模型与初始化

- 模型修改落在 `apps/server/prisma/schema.prisma` 并提供相应迁移；不要用手工改库代替可复现迁移。
- 不改写已应用的迁移来修复共享环境；新增迁移并评估已有数据兼容性，破坏性变更先取得授权。
- 初始化参考 `apps/server/src/seed/demo.ts` 的“仅补齐缺失记录”模式，保留已有账号状态和演示数据。
- 初始不灌入 Skill；`examples/hello-skill/` 仅在用户上传后进入业务数据。
- 测试环境、清理限制和验证命令读取 `.qoder/rules/verification.md`。
