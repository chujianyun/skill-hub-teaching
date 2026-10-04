---
kind: frontend_style
name: Ant Design 6 + Vite React 前端样式体系
category: frontend_style
scope:
    - '**'
source_files:
    - apps/web/package.json
    - apps/web/vite.config.ts
    - apps/web/src/main.tsx
    - apps/web/src/styles.css
    - apps/web/src/App.tsx
    - apps/web/src/pages/ConsoleLayout.tsx
    - apps/web/src/pages/LoginPage.tsx
    - apps/web/src/pages/SkillsPage.tsx
    - apps/web/src/pages/SkillManage.tsx
    - apps/web/src/pages/SkillReviewPages.tsx
---

## 1. 使用的系统/方法

- **UI 组件库**: Ant Design 6 (`antd@^6.6.5`)，配合 `@ant-design/icons` 图标库。
- **构建工具**: Vite 7 + `@vitejs/plugin-react`，无 CSS-in-JS、无 Tailwind、无 SCSS/Sass，仅使用原生 CSS。
- **国际化**: 通过 `ConfigProvider locale={zh_CN}` 在应用根节点注入中文语言包。
- **主题定制**: 未引入自定义 theme 配置或 CSS 变量覆盖，默认使用 Ant Design 6 的默认主题。

## 2. 关键文件与包

- `apps/web/package.json` — 声明 `antd`、`@ant-design/icons`、`react-router`、`react-markdown` 等依赖。
- `apps/web/vite.config.ts` — Vite 配置，仅注册 react 插件并设置 `/api` 代理到后端；无 CSS 预处理器或 PostCSS 插件。
- `apps/web/src/main.tsx` — 应用入口，使用 `<ConfigProvider locale={zhCN}>` 包裹整个应用。
- `apps/web/src/styles.css` — 全局样式，仅包含一行 `body { margin: 0; }`。
- `apps/web/src/App.tsx` — 路由定义，按角色（超管/租户管理员/工作区用户）划分 `/admin`、`/tenant`、`/workspace` 三套控制台。
- `apps/web/src/pages/*.tsx` — 所有页面组件，全部直接 import Ant Design 组件。

## 3. 架构与约定

- **单页应用结构**: 基于 `react-router v7` 的嵌套路由，三个控制台共享同一个 `ConsoleLayout`（位于 `pages/ConsoleLayout.tsx`），通过传入不同的 `brand` 和 `menu` 数组切换侧边栏。
- **样式组织方式**: 没有模块化 CSS（无 `.module.css`）、无 CSS-in-JS、无设计 token 文件。所有视觉样式由 Ant Design 组件自身提供，页面级自定义样式极少，全局样式仅重置 body margin。
- **响应式策略**: 完全依赖 Ant Design 内置的栅格（`Col`/`Row`）与响应式断点，未见媒体查询或自定义断点。
- **布局模式**: 采用 Ant Design 的 `Layout` + `Menu` + `Space` 组合构建后台控制台布局，登录页使用 `Card` + `Form` 居中卡片。
- **状态与 UI 反馈**: 统一使用 Ant Design 的 `Alert`、`Spin`、`Result`、`Modal`、`Popconfirm`、`Tooltip`、`Tag`、`Badge` 等组件表达加载、错误、确认、标签、角标等状态。
- **表单**: 全部基于 Ant Design `Form` + `Input` + `Select` + `TreeSelect` + `Radio` + `Descriptions`，并通过 `App.useApp()` 提供的 `message`/`notification` API 进行交互反馈。

## 4. 约定与约束

- **组件导入来源**: 所有页面组件直接从 `antd` 命名空间导入（如 `import { Button, Table, Form } from 'antd'`），未发现从 `antd/es/*` 子路径导入的场景（除个别类型导入如 `DataNode`、`HookAPI`）。
- **语言本地化**: 应用根节点通过 `ConfigProvider locale={zhCN}` 强制使用简体中文，未实现多语言切换能力。
- **无自定义主题**: 未在 `ConfigProvider` 中传入 `theme` 属性，也未引入任何 CSS 变量覆盖或 Ant Design 主题定制机制，整体视觉风格即 Ant Design 6 默认外观。
- **无额外 CSS 框架**: 仓库中不存在 `tailwind.config.*`、`postcss.config.*`、`.scss` 文件或 CSS-in-JS 运行时（styled-components/emotion 等），`styles.css` 仅重置 body margin。
- **图标来源**: 业务图标统一来自 `@ant-design/icons`（如 `AppstoreOutlined`、`AuditOutlined`、`FolderOutlined`），未引入第三方图标字体或 SVG sprite。
- **构建产物**: 样式经 Vite 原生 CSS 处理打包，无额外的 CSS 压缩或提取插件配置。