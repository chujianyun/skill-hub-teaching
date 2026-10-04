# 前端规则

适用于修改 `apps/web/**`，以及共享契约对网页的影响。所有路径相对仓库根目录。

## 复用现有入口

- 页面放在 `apps/web/src/pages/`，沿用 React、Ant Design 和现有路由组织；先查找可复用的页面部件。
- JSON 接口及返回 JSON 的表单上传使用 `apps/web/src/api.ts` 的 `api` 封装，保留 FormData 和 `ApiError` 的处理方式。
- ZIP 下载沿用现有鉴权下载链接，不经过 JSON 响应解析；参考 `apps/web/src/pages/SkillParts.tsx` 的 `downloadUrl`。
- 会话逻辑参考 `apps/web/src/session.tsx`；API 类型、状态和包校验使用 `@skill-hub/shared`，不要在页面另建副本。
- 修改布局或样式前检查 `apps/web/src/styles.css` 与组件现有配置，避免全局选择器意外影响其他角色页面。

## 角色与导航

- 角色入口按 `docs/migration-spec.md` 的 UI 契约维护。
- 保持 `/workspace`、`/tenant`、`/admin` 各角色路由边界，以及 `/skills/review/:versionId` 审核深链。
- 审核深链在未登录时跳转登录，登录后回到目标页；返回路径通过 `safeNext` 校验，不能接受任意外部地址。
- 保持退出登录先使服务端会话失效、再导航的顺序；不要吞掉真正的退出失败并显示已退出。
- 登录账号卡片只负责填入表单，登录仍由用户提交并经服务端验证。
- 审核链接按服务端返回的 `viewerRole`、`canReview` 决定跳转与操作入口，不仅凭“是否所有者”推断审核权限。

## 业务交互

- 上传继续支持文件夹选择、拖入和 ZIP；参考 `apps/web/src/skillSource.ts` 与 `apps/web/src/pages/UploadSkillModal.tsx`。
- 客户端校验用于及时反馈；正式版本下载与工作版本审阅使用各自入口，不能混用权限和状态。
- 提交、撤回、审核、上下架等操作等待服务端成功后再更新界面，显示加载与错误反馈，避免重复提交。
- 遇到状态冲突，提示并重新获取状态，不要强行把本地状态改成成功。
- 可见性编辑保持租户、部门、员工、私有四种语义；不要简化为单一“公开/私有”开关。
- 文件预览和 Markdown 内容按不可信数据展示，不直接执行包中的脚本或注入未净化的 HTML。

## 表格与页面检查

- 横向滚动表格的操作列固定在右侧；保持 columns 可被现有检查脚本静态识别，不绕过检查。
- 检查入口：`pnpm --filter @skill-hub/web check:tables`；网页 `typecheck` 已包含该检查。
- 布局变化至少检查桌面和窄屏，关注筛选工具栏、弹窗、文件树、长名称以及表格操作列的可达性。
- 交互变化检查加载、空数据、失败及适用的无权限状态；类型检查不能替代真实浏览器验证。
- 浏览器测试放在 `apps/web/e2e/`；现有演示主流程参考 `apps/web/e2e/demo.spec.ts`，新增独立场景可按功能拆分。
- 检查命令与构建前提读取 `.qoder/rules/verification.md`。
