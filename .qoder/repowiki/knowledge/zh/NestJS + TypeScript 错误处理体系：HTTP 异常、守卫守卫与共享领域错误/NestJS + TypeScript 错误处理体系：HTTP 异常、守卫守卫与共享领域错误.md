---
kind: error_handling
name: NestJS + TypeScript 错误处理体系：HTTP 异常、守卫守卫与共享领域错误
category: error_handling
scope:
    - '**'
source_files:
    - apps/server/src/auth/auth.guard.ts
    - apps/server/src/storage/file-upload.interceptor.ts
    - apps/server/src/skills/skill-package.ts
    - apps/server/src/health/health.controller.ts
    - packages/shared/src/skill.ts
    - apps/web/src/api.ts
    - apps/web/src/skillSource.ts
---

## 1. 总体方案

Skill Hub 后端基于 NestJS，前端基于 React + fetch。错误处理分为三层：

- **后端**：统一使用 `@nestjs/common` 内置的 HTTP 异常类（`BadRequestException`、`UnauthorizedException`、`ForbiddenException`、`ServiceUnavailableException`、`PayloadTooLargeException`），由 NestJS 全局异常过滤器自动转换为 JSON 响应。
- **跨层共享**：在 `packages/shared/src/skill.ts` 中定义纯领域错误类型 `SkillPathError extends Error`，被后端与前端共同消费，用于表达 Skill zip 路径校验失败这一业务语义。
- **前端**：封装 `ApiError extends Error`，集中拦截非 2xx 响应，将服务端返回的 `message`/`code`/原始 body 暴露给调用方。

仓库中没有自定义的 `HttpException` 子类、没有统一的错误码枚举、也没有 `try/catch` 后手动包装为业务异常的中间件——错误以“抛出 NestJS HTTP 异常”为主要传播方式。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `apps/server/src/auth/auth.guard.ts` | 全局认证守卫，通过 `UnauthorizedException` / `ForbiddenException` 拒绝未登录、越权访问 |
| `apps/server/src/storage/file-upload.interceptor.ts` | 上传拦截器，捕获 Multer 抛出的 `PayloadTooLargeException`，先 `resume()` 丢弃剩余请求体再重新抛出，避免客户端 ECONNRESET |
| `apps/server/src/skills/skill-package.ts` | Skill zip 解包逻辑，把 `SkillPathError` 与解析异常统一转为 `BadRequestException` |
| `packages/shared/src/skill.ts` | 定义 `SkillPathError extends Error`，供前后端共享的领域级错误类型 |
| `apps/web/src/api.ts` | 前端 `api()` 函数，非 2xx 时抛出 `ApiError(status, message, code, body)` |
| `apps/web/src/skillSource.ts` | 前端 Skill zip 解析，复用 `SkillPathError` 并包装为 `SourceError` |
| `apps/server/src/health/health.controller.ts` | 健康检查中使用 `ServiceUnavailableException` 表达数据库不可用 |

## 3. 架构与约定

### 3.1 后端：NestJS HTTP 异常即错误模型

所有控制器与服务直接 `throw new XxxException('中文提示')`，不自行 try/catch 后再包装。例如：

- `auth.service.ts`：密码错误或演示账号未初始化 → `UnauthorizedException`。
- `auth.guard.ts`：未登录 → `UnauthorizedException('请先登录')`；超管/租户管理员/成员权限不足 → `ForbiddenException('仅超管可访问' | '仅租户管理员可访问' | '仅本租户员工可访问' | '请先选择要进入的租户')`。
- `skill-categories.service.ts`、`skill-visibility.ts`、`skills.dto.ts` 等：参数缺失或不存在 → `BadRequestException`。
- `health.controller.ts`：数据库连接失败 → `ServiceUnavailableException({ status: 'error', db: 'down' })`。

NestJS 的全局异常过滤器将这些异常序列化为标准 JSON 响应，前端 `api.ts` 从中读取 `body.message`（支持数组取首项）作为用户可见消息。

### 3.2 共享领域错误：`SkillPathError`

`packages/shared/src/skill.ts` 定义：

```ts
export class SkillPathError extends Error { ... }
```

该类型表示“Skill zip 内路径非法（绝对路径、Windows 盘符、包含 `..`、目录项等）”，被后端 `readSkillPackage` 与前端 `skillSource.ts` 共用。后端在 catch 块中显式判断 `err instanceof SkillPathError` 并转为 `BadRequestException(err.message)`，从而把领域错误映射到 HTTP 400。

### 3.3 上传拦截器的特殊处理

`fileUploadInterceptor` 是仓库中唯一对 NestJS 异常做“二次处理”的地方：当 Multer 抛出 `PayloadTooLargeException` 时，先执行 `context.switchToHttp().getRequest().resume()` 丢弃尚未消费的请求体，再重新抛出 `PayloadTooLargeException(tooLargeMessage)`，以避免客户端因连接重置而报错。其他异常原样上抛。

### 3.4 前端：`ApiError` 统一承载 HTTP 错误

`apps/web/src/api.ts` 中：

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly body?: unknown,
  ) { super(message); }
}
```

`api()` 对所有非 2xx 响应抛出 `ApiError`，携带状态码、服务端 message、可选 code 和原始 body。调用方按 `status` 分支处理，例如 `logout()` 中忽略 401 以便静默退出。

## 4. 观察到的约定与约束

- **后端错误一律以 NestJS HTTP 异常抛出**：在已检查的后端文件中未发现自定义 `HttpException` 子类或业务异常基类；所有业务错误最终都落在 `BadRequestException` / `UnauthorizedException` / `ForbiddenException` / `ServiceUnavailableException` / `PayloadTooLargeException` 之一。
- **错误消息使用中文直出**：`UnauthorizedException('请先登录')`、`ForbiddenException('仅超管可访问')`、`BadRequestException('请选择要上传的 Skill 文件夹')` 等，前端 `api.ts` 直接透传给 UI，未见 i18n 或错误码映射层。
- **Zip 炸弹防护**：`skill-package.ts` 在 `unzipSync` 的 filter 回调中累计 `originalSize` 并通过 `checkSkillLimits` 提前抛出 `BadRequestException`，注释明确说明“fflate 按声明大小截断输出，声明值造假也不会解压出超量数据”。
- **上传体积超限必须 resume 请求体**：`fileUploadInterceptor` 强制在重抛 `PayloadTooLargeException` 前 `resume()`，这是仓库中对 HTTP 异常处理的唯一一处“副作用”约定。
- **跨层领域错误通过共享 `Error` 子类型传递**：`SkillPathError` 是唯一一个在 `packages/shared` 中定义的 `extends Error` 类型，后端与前端均 `instanceof` 判断后分别转为 HTTP 异常或应用错误。
- **前端无全局错误边界**：React 侧未发现 `componentDidCatch` / `useEffect` 中的全局 error boundary；错误主要通过 `ApiError` 向组件冒泡，由页面组件自行展示。
- **未观察到 panic/recover 或 `process.on('uncaughtException')`**：Node 进程级错误未被捕获，依赖运行时默认行为。

## 5. 不在仓库中的内容

- 没有统一的错误码枚举或错误响应 DTO（除 health check 外）。
- 没有自定义 `@Catch` 装饰器或全局异常过滤器实现。
- 没有日志记录框架集成（如 Winston/Pino）的错误日志输出。
- 没有前端全局错误边界或 toast 错误中心。
