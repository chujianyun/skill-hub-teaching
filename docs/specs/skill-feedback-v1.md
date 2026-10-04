# Skill Feedback v1

## Problem Statement

Skill 作者在发布 Skill 后，无法收集使用者的问题和反馈。普通用户在遇到 Skill 使用问题时，没有正式渠道向作者或管理员报告。当前系统只有审核流程（针对版本发布），缺少使用阶段的问题跟踪能力。

## Solution

在 Skill 详情页新增"使用反馈"标签，允许任何能访问该 Skill 的租户成员提交问题反馈（标题 + 描述 + 可选版本上下文）。Skill 作者和租户管理员可以查看反馈列表，将状态从"待处理"推进到"处理中"再到"已解决"，并在解决时填写处理说明。"我的 Skill"页面增加待处理反馈数量列，方便作者快速定位需要关注的问题。

## User Stories

1. As a 普通用户, I want to 在 Skill 详情页看到"使用反馈"标签, so that 我可以向作者报告使用中遇到的问题
2. As a 普通用户, I want to 填写问题标题和描述来提交反馈, so that 作者能了解我遇到的具体问题
3. As a 普通用户, I want to 在提交反馈时选择一个正式版本作为上下文（可选）, so that 作者能知道问题出现在哪个版本
4. As a 普通用户, I want to 看到该 Skill 的所有反馈列表, so that 我知道其他人也遇到了哪些问题
5. As a 普通用户, I want to 看到每条反馈的当前状态, so that 我知道问题是否已被处理
6. As a 普通用户, I want to 按状态筛选反馈列表, so that 我可以快速找到待处理或已解决的问题
7. As a Skill 作者, I want to 在"我的 Skill"页面看到每个 Skill 的待处理反馈数量, so that 我能快速识别需要关注的 Skill
8. As a Skill 作者, I want to 点击待处理反馈数量跳转到反馈标签, so that 我能立即查看和处理反馈
9. As a Skill 作者, I want to 把反馈状态从"待处理"改为"处理中", so that 提交者知道我已看到并开始处理
10. As a Skill 作者, I want to 把反馈从"待处理"或"处理中"直接标记为"已解决"并填写处理说明, so that 提交者知道问题如何解决
11. As a 租户管理员, I want to 管理我租户内所有 Skill 的反馈（不限于我拥有的 Skill）, so that 我能协助处理 Skill 使用问题
12. As a 租户管理员, I want to 在 Skill 详情页的反馈标签中查看和管理反馈, so that 我和作者有相同的管理能力
13. As a 超管, I want to 不参与反馈流程, so that 反馈保持租户内隔离
14. As a 普通用户, I want to 在 Skill 被删除后看不到相关反馈, so that 数据一致性得到保证（级联删除）
15. As a Skill 作者, I want to 跳过"处理中"直接将反馈标记为"已解决", so that 简单问题可以快速关闭
16. As a 普通用户, I want to 对同一个 Skill 提交多条反馈, so that 不同问题可以分别跟踪

## Implementation Decisions

### 数据模型

新增 `SkillFeedback` 表：

```prisma
enum FeedbackStatus {
  pending
  in_progress
  resolved
}

model SkillFeedback {
  id                  String         @id @default(uuid()) @db.Uuid
  skillId             String         @db.Uuid
  skill               Skill          @relation(fields: [skillId], references: [id], onDelete: Cascade)
  title               String
  description         String
  status              FeedbackStatus @default(pending)
  submitterEmployeeId String         @db.Uuid
  submitterEmployee   Employee       @relation("submittedFeedbacks", fields: [submitterEmployeeId], references: [id])
  contextVersionId    String?        @db.Uuid
  contextVersion      SkillVersion?  @relation(fields: [contextVersionId], references: [id])
  resolverEmployeeId  String?        @db.Uuid
  resolverEmployee    Employee?      @relation("resolvedFeedbacks", fields: [resolverEmployeeId], references: [id])
  resolution          String?
  createdAt           DateTime       @default(now())
  resolvedAt          DateTime?
}
```

- 反馈绑定到 Skill，不绑定版本。`contextVersionId` 仅记录提交时的版本上下文，不影响反馈归属。
- Skill 删除时通过外键 `onDelete: Cascade` 级联删除反馈。
- `resolverEmployeeId` 和 `resolution` 在状态变为 `resolved` 时填入，其他状态为 null。
- 不单独记录"谁把状态改为处理中"——教学演示项目，一个 status 字段足够。

### 状态流转

```
pending ──→ in_progress ──→ resolved
   └──────────────────────────→ resolved（允许跳过）
```

- 允许：pending → in_progress、pending → resolved、in_progress → resolved
- 不允许：回退、重开、关闭
- "处理中"只需点击，不需填写说明
- "已解决"必须填写 resolution

### 权限模型

| 操作 | 允许角色 |
|---|---|
| 提交反馈 | 所有能访问该 Skill 的租户成员（含管理员），通过可见性规则判断 |
| 查看反馈列表 | 同上 |
| 管理反馈（改状态、填说明） | Skill 作者（`ownerEmployeeId`）或租户管理员（`isTenantAdmin`） |
| 超管 | 不参与，看不到反馈 |

- 反馈可见性跟随 Skill 可见性：能看到 Skill 的人就能提交和查看反馈。
- 管理权限复用现有 `canManage(viewer, skill)` 判断（作者或租户管理员）。
- 租户隔离：反馈查询始终限定在当前租户。

### 后端 API

新建 `SkillFeedbacksController` + `SkillFeedbacksService`，放在 `apps/server/src/skills/` 目录下，与审核流程平级。

| 端点 | 方法 | 说明 | 权限 |
|---|---|---|---|
| `/skills/:skillId/feedbacks` | GET | 获取反馈列表，支持 `?status=pending` 筛选 | 能访问该 Skill 的租户成员 |
| `/skills/:skillId/feedbacks` | POST | 提交反馈（title, description, contextVersionId?） | 同上 |
| `/skills/:skillId/feedbacks/:feedbackId` | PATCH | 更新状态。body: `{ status, resolution? }` | Skill 作者或租户管理员 |
| `/skills/:skillId/feedbacks/pending-count` | GET | 返回该 Skill 的 pending 数量 | Skill 作者或租户管理员 |

- GET 列表按 `createdAt` 倒序，不分页（教学演示项目反馈量小）。
- POST 提交时 `contextVersionId` 可选，若提供则校验该版本属于此 Skill 且状态为 published。
- PATCH 更新时校验状态流转合法性（只允许上述三种转换），resolved 必须提供 resolution。
- 不可见的 Skill 返回 404，可见但无管理权限返回 403（与现有 Skill 接口一致）。

### 共享契约

在 `packages/shared/src/skill.ts` 中新增：

- `FeedbackStatus` 类型：`'pending' | 'in_progress' | 'resolved'`
- `FEEDBACK_STATUS_LABELS` 标签映射
- `SkillFeedbackInfo` 接口：反馈列表项的响应类型
- `SkillFeedbackPendingCount` 接口：`{ count: number }`
- `CreateSkillFeedbackRequest` 接口：`{ title, description, contextVersionId? }`
- `UpdateSkillFeedbackRequest` 接口：`{ status, resolution? }`

### 前端 — Skill 详情页

在 `SkillsPage.tsx` 中将现有 Card 结构改为 Ant Design `Tabs` 组件：

- **Tab 1 "详情"**：保留现有全部内容（主信息卡、工作版本卡、版本历史、审核记录）
- **Tab 2 "使用反馈"**：
  - 上方：提交表单（标题输入、描述文本域、可选版本下拉），所有可访问用户可见
  - 下方：状态筛选器（Ant Design `Segmented`：全部 / 待处理 / 处理中 / 已解决）+ 反馈表格
  - 表格列：状态标签（彩色 Tag）、标题、提交人、上下文版本、创建时间、操作（仅管理者可见）
  - 操作列：待处理可改"处理中"或"已解决"（弹窗填 resolution）；处理中可改"已解决"（弹窗填 resolution）

### 前端 — "我的 Skill"页面

在 `MySkillsPage.tsx` 表格中新增"待处理反馈"列：

- 有待处理反馈时显示数字（如 `3`），点击跳转到 `/skills/:id?tab=feedback`
- 无待处理时显示 `-`
- 仅对 Skill 作者显示（"我的 Skill"本身就是作者视角）

### 前端 — 路由与参数

- Skill 详情页支持 `?tab=feedback` URL 参数，自动切换到反馈标签
- 从"我的 Skill"点击待处理数字时携带此参数跳转

### 模块注册

`SkillFeedbacksController` 和 `SkillFeedbacksService` 注册在现有的 `SkillsModule` 中，不新建模块。

## Testing Decisions

### 什么是好测试

- 只测外部行为（HTTP 状态码、响应体、数据库状态），不测内部实现
- 测试名使用中文描述句，与现有测试风格一致
- 每个测试独立：`beforeEach` 重置数据库并重新 seed

### API 测试

新增 `apps/server/test/skill-feedback.e2e-spec.ts`，覆盖：

1. **提交反馈**：能访问 Skill 的租户成员可以提交；不可见 Skill 返回 404；缺少 title 返回 400；可选 contextVersionId 校验
2. **查看反馈列表**：能访问 Skill 的人可以看到列表；按 status 筛选；按 createdAt 倒序
3. **管理反馈**：作者可以改状态；租户管理员可以改状态；非作者非管理员返回 403；状态流转合法性校验（不允许回退、不允许无效转换）；resolved 必须提供 resolution
4. **待处理数量**：作者和管理员可以获取；普通用户不可获取
5. **级联删除**：删除 Skill 后反馈一并删除
6. **超管隔离**：超管无法访问反馈接口
7. **并发安全**：并发状态更新不产生不一致

测试数据构造沿用现有 `sessionAgent`、`tenantAdminAgent`、`employeeAgent` 模式。Skill 上传沿用 `skillFolderZip` + upload API。

### 浏览器测试

在 `apps/web/e2e/` 新增 `feedback.spec.ts`，覆盖：

1. 普通用户在 Skill 详情页看到反馈标签，提交反馈，查看反馈列表
2. 作者在"我的 Skill"看到待处理反馈数字，点击跳转到反馈标签
3. 作者/管理员修改反馈状态，填写处理说明并标记已解决
4. 状态筛选器工作正常

### 测试层级

- API 测试为主要验证手段（最高 seam）
- 浏览器测试验证关键交互路径
- 不需要单元测试（Service 逻辑通过 API 测试覆盖）

## Out of Scope

- **通知**：反馈提交或解决时不发送通知（站内信、邮件等）
- **搜索和分页**：反馈列表不支持搜索和分页
- **反馈编辑/删除**：提交后不可修改或删除
- **超管视图**：超管不参与反馈流程
- **反馈导出**：不支持导出反馈数据
- **重开/关闭**：已解决的反馈不能重新打开，没有"已关闭"状态
- **指派**：反馈不指派给特定处理人，任何有权限的管理者都可以处理
- **反馈回复/讨论**：不支持在反馈下追加评论
- **反馈与审核流程的关联**：反馈独立于版本审核，不影响版本状态

## Further Notes

- 本功能是教学演示项目的扩展，保持简单。状态机、权限模型和 API 模式均与现有审核流程对齐，降低理解成本。
- 反馈标签页的 UI 改造（将 Card 结构改为 Tabs）需要确保现有内容完整保留，不破坏已有的工作版本卡、版本历史和审核记录功能。
- `contextVersionId` 字段虽然不影响反馈归属，但为用户提供有价值的上下文信息，帮助作者定位问题版本。
