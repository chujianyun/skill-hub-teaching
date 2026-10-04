---
kind: logging_system
name: 无结构化日志系统 — 仅使用 console.* 输出
category: logging_system
scope:
    - '**'
source_files:
    - apps/server/src/main.ts
    - apps/server/src/app.setup.ts
    - apps/server/src/seed.ts
    - apps/server/test/reset-db.ts
---

## 结论

该仓库**没有实现任何结构化日志系统**。后端 NestJS 应用未引入 Winston、Pino、Bunyan、log4js 等第三方日志库，也未通过 `app.setLogger()` 或 `@nestjs/common` 的 `Logger` 服务进行统一日志配置。所有运行时输出均直接使用 Node.js 原生的 `console.log` / `console.error`。

## 证据

- 全局搜索 `Logger|logger|winston|pino|bunyan|log4js|setLogger` 在 `.ts` 文件中返回 0 个匹配。
- 唯一出现日志输出的位置是两条一次性脚本：
  - `apps/server/src/seed.ts:5`：`console.log('演示账号和团队已就绪')` 与 `console.error(err)`。
  - `apps/server/test/reset-db.ts:7`：`console.error(e)`。
- 应用启动入口 `apps/server/src/main.ts` 仅调用 `NestFactory.create` + `configureApp`，未设置任何 Logger。
- 应用初始化 `apps/server/src/app.setup.ts` 仅配置了全局前缀、cookie 解析、`ValidationPipe` 与 `enableShutdownHooks`，不包含日志相关逻辑。

## 架构与约定

- **框架层**：NestJS 默认 Logger（基于 `console`）未被替换；业务代码中也没有手动注入 `Logger` 服务的用法（搜索结果为 0）。
- **输出目标**：标准输出/标准错误（stdout/stderr），由 Docker Compose 或宿主机控制台收集。
- **日志级别**：未定义自定义级别；仅区分“正常信息”（`console.log`）与“异常/错误”（`console.error`）。
- **结构化字段**：不存在统一的日志记录器，因此没有统一的字段规范（如 `level`、`service`、`traceId`、`tenantId` 等）。
- **测试环境**：e2e 测试（`apps/server/test/*.e2e-spec.ts`）同样未见日志框架引用，依赖 Jest 自身的 stdout 捕获。

## 约束

- 当前代码库中**不存在**强制性的日志框架或日志格式规范；唯一的约束来自实际代码行为：除 seed 与 reset-db 两个脚本外，其余模块均未主动产生日志输出。
- 由于未发现任何日志中间件、拦截器或装饰器来统一捕获请求/响应日志，HTTP 请求的生命周期不会留下结构化访问日志。