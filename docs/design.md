# 网页翻译浏览器插件 — 技术架构设计文档

> 关联需求文档：[proposal.md](./proposal.md)
> 本文档仅描述技术架构与设计约定，不包含代码实现。

## 1. 文档目的与范围

本文档基于需求文档，明确插件的整体技术选型、模块划分、数据流、目录结构与编码规范，作为后续编码实现的依据。重点关注三件事：

1. **内容提取**：如何在任意英文网站稳定地提取"主要文章内容"并转换为 Markdown（本项目关键与难点）。
2. **AI 翻译**：如何以 OpenAI SDK 兼容的方式调用大模型，并便于在多个模型间切换（本项目使用 Qwen）。
3. **结果展示**：如何用 `md-wx` 组件以打字机效果呈现 Markdown 翻译结果。

## 2. 技术栈总览

| 领域 | 选型 | 说明 |
|------|------|------|
| 浏览器平台 | Chrome Extension（Manifest V3） | 现代 Chrome 扩展标准 |
| 内容提取 | Mozilla Readability | 识别并抽取页面正文，行业事实标准 |
| HTML → Markdown | Turndown（含 GFM 插件） | 将提取后的 DOM 转为 Markdown，保留图片/列表/链接/表格等 |
| UI 框架 | React + TypeScript | 承载 `md-wx` 组件与打字机交互 |
| Markdown 渲染 | `md-wx`（npm 包） | 面向公众号优化的 Markdown 渲染组件库 |
| 构建工具 | Vite（配合扩展构建插件） | 快速开发、热更新、多入口打包 |
| AI 调用 | OpenAI SDK（Node.js） | 以 OpenAI 兼容协议调用，切换模型仅需改 `baseURL` / `model` |
| 大模型 | Qwen（阿里云百炼 / DashScope） | 通过 OpenAI 兼容接口调用 |
| 本地持久化 | `chrome.storage.local` | 保存最近一次翻译结果 |

## 3. 内容提取方案（关键与难点）

### 3.1 问题分析

任意网站正文提取的难点在于：网页结构千差万别，正文中混有导航、广告、侧边栏、评论、弹窗、页脚等噪声；图片存在懒加载、`<picture>` 多源、相对路径等复杂情况。手动编写选择器规则无法通用。

### 3.2 选型结论

采用业界成熟的两段式方案，这也是多个同类开源插件（如 MarkDownload、LLMFeeder、2md、Page to Markdown 等）验证过的通用路径：

1. **Mozilla Readability**：负责"找正文"。它通过分析 DOM 结构与文本密度，对每个元素打分，移除低分噪声元素，输出干净的正文 HTML，同时能识别标题、作者（byline）等元信息。这是 Firefox 阅读模式的基础算法。
2. **Turndown**：负责"转 Markdown"。将 Readability 输出的 HTML 转为 Markdown，并启用 GFM 插件以保留表格、删除线、任务列表等扩展语法。

### 3.3 关键处理规则

- **图片转换**：将 `<img>`、`<picture>`、懒加载图片统一转换为 `![alt](src)`；`alt` 取图片 `alt`/`title` 属性，`src` 优先取真实高清源并解析相对路径为绝对 URL。
- **元信息提取**：从 Readability 结果与页面 `<meta>` 标签中提取标题、作者、原文 URL，供最终输出格式使用。
- **执行环境**：正文提取必须在 **content script** 中运行，因为它需要直接访问页面 DOM；Readability 与 Turndown 运行在隔离/注入环境中，与页面自身脚本互不干扰。
- **兜底策略**：当 Readability 无法识别正文（如非标准布局页面）时，提供降级方案（如按常见正文标签/`<article>` 元素兜底提取）。

### 3.4 备选方案对比

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 自研选择器/正则提取 | 无额外依赖 | 通用性差、维护成本高 | 不采用 |
| 纯 LLM 直接读 DOM 提取 | 理论上更"智能" | 需发送大量 DOM、成本高、不稳定 | 不采用（仅作辅助可选） |
| Readability + Turndown | 成熟稳定、社区验证充分 | 需引入两个依赖 | **采用** |
| Mercury/Postlight Parser | 功能全 | 依赖较重、偏服务端、已停止维护 | 不采用 |
| trafilatura | 质量高 | Python 生态，不适合浏览器端 | 不采用 |

## 4. AI 翻译方案（OpenAI SDK 兼容 + Qwen）

### 4.1 兼容方式

使用 **OpenAI SDK**（Node.js 版 `openai` 包），通过配置 `baseURL` 与 `apiKey` 指向兼容端点，无需绑定具体厂商：

- 切换模型/厂商时，仅需调整 `baseURL`、`model` 与 `apiKey`，业务代码不变。
- Qwen 通过阿里云百炼的 **OpenAI 兼容接口** 调用，`baseURL` 形如 `https://dashscope.aliyuncs.com/compatible-mode/v1`，`model` 使用 `qwen-plus` / `qwen-max` 等（最终模型名以配置为准）。
- API Key 由用户自行配置并保存在本地，避免硬编码。

### 4.2 流式输出与打字机效果

- 翻译请求开启**流式输出**（`stream: true`），基于 SSE 持续返回文本片段（chunk）。
- 前端逐块累积并渲染，天然实现打字机效果，同时避免长文本一次性返回的等待与超时。
- 每个 chunk 的增量文本追加到 Markdown 内容末尾，由 `md-wx` 组件实时渲染。

### 4.3 提示词设计要点

- 使用 system 提示词明确翻译约束：英译中、保留 Markdown 结构与图片链接格式（`![alt](src)`）、不改动标题/作者/链接等占位信息。
- 输入为提取后的 Markdown 正文；输出为翻译后的 Markdown 正文，最终由前端拼接成固定输出格式。

## 5. 本地持久化方案

- 使用 `chrome.storage.local` 保存最近一次翻译结果。
- 存储内容建议包含：文章标题、作者、原文链接、原文 Markdown、翻译后 Markdown、生成时间等。
- 无历史记录：每次翻译成功后覆盖上一次结果。
- 用户再次打开插件时，读取存储并恢复展示。

## 6. Markdown 渲染（md-wx 组件）

### 6.1 集成方式

`md-wx` 是一个 npm 包，可在 React 项目中快速引入：

- **安装**：通过 npm 安装 `md-wx` 依赖。
- **引入**：在 React 组件中引入 `MarkdownRenderer` 组件及其样式文件（`md-wx/dist/style.css`）。
- **使用**：将翻译后的 Markdown 字符串传入 `MarkdownRenderer` 的 `markdown` 属性即可渲染。

### 6.2 与本项目相关的关键能力

| 能力 | 说明 | 本项目用法 |
|------|------|-----------|
| `markdown` 属性 | 传入要渲染的 Markdown 内容 | 传入流式累积的翻译结果 |
| `theme` 属性 | 支持多主题（minimal / sakura / forest / ocean / sunset） | 默认主题即可，可开放切换 |
| `enableCopy` / `onCopy` | 一键复制到公众号编辑器/剪贴板 | 提供给用户复制结果 |
| `enableThemeSwitch` / `enableViewModeToggle` | 主题切换与视图模式切换 | 按需开启 |
| `showSettings` | 是否显示设置面板 | 按需开启 |
| Hooks（`useTheme`、`useCopyToClipboard` 等） | 提供主题、复制等能力 | 用于封装自定义交互 |

> 说明：`md-wx` 主要负责最终的 Markdown 渲染与复制能力；打字机效果由上层通过流式增量更新 `markdown` 内容实现，两者职责分离。

## 7. 系统架构与数据流

### 7.1 模块划分

| 模块 | 位置 | 职责 |
|------|------|------|
| Content Script | `src/content` | 注入页面，调用 Readability + Turndown 提取正文并转为 Markdown，返回元信息 |
| Background Service Worker | `src/background` | 消息路由、API Key 读取、翻译请求发起、结果持久化 |
| Popup（React 应用） | `src/popup` | 用户交互入口：触发提取/翻译、展示打字机效果、渲染 md-wx 结果 |
| 组件层 | `src/components` | 封装 md-wx、打字机容器、加载/错误状态等 UI 组件 |
| 服务层 | `src/services` | 翻译服务（OpenAI 流式调用）、存储服务、提取服务 |
| 库封装层 | `src/lib` | 对 Readability、Turndown、OpenAI SDK 等第三方库的统一封装 |

### 7.2 核心数据流

1. 用户在页面点击插件图标，打开 Popup。
2. Popup 通过消息向 Content Script 请求"提取正文"。
3. Content Script 用 Readability 抽取正文 → Turndown 转为 Markdown → 返回 `{标题, 作者, 原文链接, 图片, Markdown}`。
4. Popup（或 Background）读取用户配置的 API Key，构造翻译请求。
5. 通过 OpenAI SDK 以流式方式调用 Qwen，逐块接收翻译增量。
6. Popup 将增量累积并更新 `markdown`，由 md-wx 组件实时渲染（打字机效果）。
7. 翻译完成后，拼接固定输出格式并写入 `chrome.storage.local`。
8. 再次打开 Popup 时，优先读取并展示上次存储的结果。

### 7.3 关键设计决策

- **流式请求发起位置**：流式请求需要持久连接。Chrome MV3 的 Service Worker 可能被回收，因此流式翻译调用建议在**常驻的前端上下文（Popup）** 中发起，Background 仅负责消息路由、存储与静态配置读取，避免连接被中断。
- **存储 Key 设计**：使用单一存储 Key 保存"最近一次结果"，保证无历史记录、仅覆盖更新。
- **配置安全**：API Key 等敏感信息仅存本地，不随代码提交，不进入版本库。

## 8. 目录结构规范

```
chrome-extension-en-translation/
├── docs/                      # 文档
│   ├── proposal.md            # 需求文档
│   ├── design.md              # 本技术架构文档
│   └── md-wx-api-usage.md     # md-wx 参考文档
├── public/                    # 静态资源
│   ├── manifest.json          # Manifest V3 配置
│   └── icons/                 # 插件图标
├── src/
│   ├── background/            # Service Worker（消息路由、存储）
│   ├── content/               # Content Script（正文提取）
│   ├── popup/                 # Popup 入口（React 应用）
│   ├── components/            # 通用 React 组件（md-wx 封装、打字机容器等）
│   ├── services/              # 业务服务（翻译、存储、提取）
│   ├── lib/                   # 第三方库封装（Readability、Turndown、OpenAI）
│   ├── types/                 # TypeScript 类型定义
│   └── utils/                 # 工具函数
├── scripts/                   # 构建/辅助脚本
├── package.json
├── tsconfig.json
└── vite.config.ts             # 多入口构建配置
```

约定说明：

- `public` 仅存放需要原样输出的静态资源与 manifest；manifest 中的路径通过构建工具映射到 `src` 各入口产物。
- 各模块按职责分层，避免 Content Script、Background、Popup 之间互相直接引用实现细节，统一通过 `types` 中的消息协议类型通信。

## 9. 编码规范

### 9.1 语言与规范

- 全项目使用 **TypeScript**，开启严格模式（`strict`），不滥用 `any`。
- 使用 **ESLint + Prettier** 统一代码风格与格式化，提交前自动检查。
- 命名约定：
  - 文件：组件用 `PascalCase`，其余用 `kebab-case` 或 `camelCase`，保持一致。
  - 变量/函数：`camelCase`。
  - 类型/接口/组件：`PascalCase`。
  - 常量：`UPPER_SNAKE_CASE`。
  - 私有成员：以 `_` 前缀标记（如无必要不强求）。
- 每个模块职责单一，函数尽量短小、可测试。

### 9.2 消息与类型约定

- Content Script、Background、Popup 之间的通信统一通过 Chrome 消息机制，并在 `types` 中集中定义消息类型、请求/响应数据结构，避免魔法字符串与隐式契约。
- 与 AI 交互的数据结构（提取结果、翻译请求、翻译结果）单独定义类型，保证跨层一致。

### 9.3 错误处理与日志

- 提取失败、翻译失败、网络异常、API Key 缺失等场景均需有明确的分支处理，并在 UI 中给出可读提示。
- 使用统一日志方式（开发环境输出调试信息，生产环境收敛），避免泄露 API Key 等敏感信息。

### 9.4 注释规范

- 注释用于解释"为什么"，而非复述代码"做了什么"。
- 复杂逻辑（如正文提取、流式累积渲染）需有必要的说明注释。
- 中文注释需与代码语言规则保持一致（中文注释、英文标识符）。

### 9.5 提交与依赖

- 遵循常规 commit 信息规范，语义清晰。
- 依赖锁定版本，避免非预期的升级破坏构建。

## 10. 依赖清单

| 依赖 | 用途 |
|------|------|
| `@mozilla/readability` | 正文内容提取 |
| `turndown` + `turndown-plugin-gfm` | HTML 转 Markdown，GFM 语法支持 |
| `openai` | OpenAI SDK，兼容协议调用 Qwen |
| `react` / `react-dom` | UI 框架 |
| `md-wx` | Markdown 渲染组件 |
| `typescript` | 类型系统 |
| `vite` + 扩展相关插件 | 构建打包 |
| `eslint` / `prettier` | 代码规范与格式化 |

## 11. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 非标准页面正文提取失败 | 无法翻译 | Readability 提取 + 常见标签兜底策略 |
| 图片懒加载导致 `src` 缺失 | 图片丢失 | 解析懒加载属性与 `<picture>` 多源，还原真实 URL |
| MV3 Service Worker 被回收 | 流式连接中断 | 流式请求放在常驻前端上下文发起 |
| API Key 泄露 | 安全风险 | Key 仅存本地、不进版本库、不打印日志 |
| 长文本翻译超时 | 体验差 | 采用流式输出，逐块返回避免超时 |

## 12. 参考来源

- Mozilla Readability：https://github.com/mozilla/readability
- Turndown：https://github.com/mixmark-io/turndown
- 阿里云百炼 OpenAI 兼容接口：https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
- 阿里云百炼流式输出：https://help.aliyun.com/zh/model-studio/user-guide/streaming-output-1
- 同类开源插件（方案参考）：MarkDownload、LLMFeeder、2md、Page to Markdown
