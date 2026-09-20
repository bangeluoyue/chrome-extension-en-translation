# AI 双语文章阅读助手 — 设计文档

> 关联需求文档：[proposal.md](./proposal.md)
>
> 页面布局：[layouts/README.md](./layouts/README.md)
>
> 验收记录：[acceptance.md](./acceptance.md)

## 1. 设计原则

Demo 基线已经完成；下一阶段以“稳定日常使用”为目标，不为了可能出现的未来需求提前搭建复杂架构。

- 优先增加用户能直接感知的功能。
- 复用现有提取、翻译、渲染和存储代码。
- 数据量很小，统一使用 `chrome.storage.local`。
- 翻译请求保持串行；长文章可以顺序分段，但不增加并发调度。
- 各任务按功能边界拆分，但不额外创建抽象层。

## 2. 页面与职责

### 2.1 Popup

- 展示当前页面和最近结果的简单状态。
- 提供“一键翻译”、最近一篇和设置入口。
- 提取成功后打开 Side Panel；Side Panel 不可用时打开 Result。
- 不在 Popup 内执行或展示长时间翻译。
- 不展示完整 Markdown，不保留重复的复制和下载入口。

### 2.2 Side Panel

侧边栏是 Demo 的主要阅读界面：

- 显示文章标题、来源和翻译状态。
- 展示原文、译文或双语内容。
- 提供取消、重新翻译、复制和下载操作。
- 展示划词翻译结果。
- 展示最近 20 篇历史的简洁列表。

为减少重复实现，侧边栏和现有结果页尽量复用同一套阅读组件和翻译逻辑。

### 2.3 Result

- 保留现有独立结果页。
- 当 Side Panel API 不可用或用户想宽屏阅读时使用。
- 与侧边栏读取同一份待翻译内容和最近结果。

### 2.4 Settings

- 编辑 API Key、模型和 Base URL。
- 测试当前配置是否能连接模型。
- API Key 仍只保存在本地浏览器。

### 2.5 Background 与 Content Script

- 正文提取脚本继续负责页面解析，但不再静态匹配站点；Popup 的用户点击通过浏览器适配层将它注入当前标签页。
- Background 负责创建划词右键菜单、接收选中文字并打开侧边栏。
- 页面间消息只覆盖“打开侧边栏”“翻译文章”“翻译选区”三类用途。

## 3. 简化数据结构

### 3.1 用户配置

```ts
interface UserConfig {
  apiKey: string
  model: string
  baseUrl: string
}
```

### 3.2 文章翻译结果

继续沿用现有 `TranslationResult`；历史记录在其基础上补充唯一 ID：

```ts
interface TranslationResult {
  title: string
  author: string
  sourceUrl: string
  originalMarkdown: string
  translatedMarkdown: string
  createdAt: number
}

interface TranslationHistoryEntry extends TranslationResult {
  id: string
}
```

### 3.3 划词翻译

```ts
interface SelectionTranslation {
  sourceText: string
  translatedText: string
  pageTitle: string
  sourceUrl: string
}
```

划词翻译只保留当前侧边栏会话，不进入文章历史。

### 3.4 存储键

| Key | 内容 |
|-----|------|
| `userConfig` | API Key（可单独清除）、模型和 Base URL |
| `readingMode` | 最近一次选择的阅读模式 |
| `pendingTranslation` | 当前待翻译文章 |
| `translationProgress` | 当前文章已完成的分段译文与分段总数 |
| `storageVersion` | 当前存储结构版本 |
| `translationResults` | 按结果 ID 保存的完整文章记录表 |
| `lastResult` | 最近结果 ID；不重复保存正文 |
| `translationHistory` | 最近 20 篇的 ID、标题、作者、来源与时间 |
| `pendingSelection` | 最近一次待处理选中文字 |

结果 ID 由来源 URL 与创建时间组成。读取旧版完整 `lastResult` 或完整历史数组时，存储服务自动执行一次幂等迁移；页面 API 仍返回完整结果，不暴露内部引用结构。

## 4. 翻译流程

### 4.1 当前文章翻译流程

1. Popup 在用户点击后以 `activeTab` 和 `scripting` 注入正文提取脚本，再请求当前文章。
2. 保存 `pendingTranslation` 并打开侧边栏。
3. 共享阅读界面用纯函数计算 Unicode 字符数和 Markdown 块数；超过 30,000 字符时显示上下文风险。
4. 普通文章保持一次请求；长文章由纯分段器按 Markdown 块打包，串行执行器逐段调用受保护的单请求翻译服务。
5. 每段请求前将围栏代码、行内代码、图片 URL 和普通链接目标替换为有序标记；流式响应中恢复原值。
6. 单段结束时校验标记数量、顺序和 Markdown 代码围栏。只有校验通过的完整段才写入独立的 `translationProgress` 检查点。
7. 同一篇文章重新打开或点击继续时校验检查点，从第一个未完成段恢复，并把已完成译文作为显示起点。
8. 全部完成后一次写入完整结果、最近 ID 和轻量历史，并在同次容量安全写入中清空待翻译文章与临时检查点。
9. 取消或失败只保留完整段，不写入历史；新文章、打开完成结果或明确重新翻译时清除旧检查点。

### 4.2 划词翻译

1. Background 从右键菜单取得 `selectionText`。
2. 将文本和页面信息保存到 `pendingSelection`，然后打开侧边栏。
3. 侧边栏确认已保存模型端点拥有可选 Host Permission，再调用现有翻译服务。
4. 结果显示在独立的划词卡片中，不修改文章结果。

## 5. UI 状态

整篇翻译只保留简单状态：

```ts
type TranslationStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'complete'
  | 'cancelled'
  | 'error'
```

- `loading`：读取文章或配置。
- `streaming`：模型正在生成译文；多段文章显示“正在翻译第 N/M 段”。
- `complete`：翻译完成，可保存、复制和下载。
- `cancelled`：用户主动停止，保留完整段并可继续或重新翻译。
- `error`：展示失败段、已完成段数和对应恢复操作；结构校验错误同样停留在当前段。

不显示虚假的百分比；流式生成时用文字状态和动态指示表示进度。
文章规模预检独立于翻译状态：普通文章显示简洁规模，长文章额外显示上下文风险，不改变按钮状态或请求流程。

## 6. 组件复用边界

Side Panel 和 Result 只共享确实重复使用的阅读能力：

- `ReaderView`：文章信息、状态和阅读区域。
- `ReadingModeSwitch`：三种阅读模式切换。
- `TranslationActions`：取消、重译、复制和下载。

`SelectionCard` 和 `HistoryList` 只属于 Side Panel，不为了目录整齐抽成跨页面模块。翻译逻辑可以整理为一个简单 Hook，但不引入领域层、Port、Repository 或通用状态机。只有出现真实重复时才提取公共代码。

仅译文与双语 Markdown 统一由 `utils/translationMarkdown.ts` 生成，均包含标题、作者和原文链接；复制内容不依赖当前阅读模式。下载复用双语格式输出，文件名由 `utils/downloadMarkdown.ts` 根据文章标题生成并清理非法字符。

## 7. 兼容和降级

- 优先使用 Chrome Side Panel API。
- 如果 API 调用失败，回退到现有结果页。
- Readability 无法提取时提示用户换普通文章页或刷新重试。
- 模型调用失败时保留原文，并允许重新翻译。

## 8. 验证策略

- Vitest 在 jsdom 中覆盖配置、抽取、流式翻译、阅读、划词、历史和输出流程，Chrome API 由统一 Mock 提供。
- 正文抽取另用不同站点的真实页面快照验证，避免只对合成 HTML 生效。
- 外部模型连接不保存测试结果；发布前按 [验收记录](./acceptance.md) 的最短步骤使用个人配置手动复验。

## 9. 下一阶段架构边界

### 9.1 长文翻译管线

```text
Markdown ─► 规模预检 ─► 安全分段 ─► 结构保护 ─► 串行模型请求
                                                    │
完整译文 ◄─ 合并与校验 ◄─ 恢复代码和 URL ◄────────┘
                     │
                     └─► 临时进度存储
```

- 规模预检、安全分段和结构保护均为无 React、Chrome API 与存储依赖的纯函数，分别单元测试。
- 任务 17 的规模预检位于 `src/lib/articleSizePreflight.ts`；它与任务 18 的分段器共同复用 `src/lib/markdownBlocks.ts` 的块信息。
- `src/lib/markdownSegmenter.ts` 以 30,000 字符为片段上限，优先让标题跟随后续内容，且不在列表、表格和代码围栏内部切分；单个超限原子块保持完整。
- `src/lib/markdownProtection.ts` 负责保护与恢复代码和链接目标，并校验保护标记及 Markdown 围栏；它不调用模型、React、Chrome API 或存储。
- `src/services/translation.ts` 只负责单段模型请求；`src/services/articleTranslation.ts` 负责严格串行、取消传递、真实进度、断点恢复和译文顺序合并，不直接渲染界面。
- 单段请求会明确要求完整逐句翻译，并列出该段全部保护标记供模型逐字核对；响应端仍执行独立的数量、顺序和围栏校验，提示词不能替代校验。
- `src/services/protectedMarkdownTranslation.ts` 包装文章的单段模型流，在段完成前执行恢复与校验；划词翻译继续直接使用独立的文本翻译入口。
- React 页面消费译文流和进度事件，并将完整段保存到独立的 `translationProgress`；完成结果仍使用既有 `TranslationResult`，不会混入临时状态。
- 保护与校验不读取串行队列状态；校验错误作为当前段失败交回既有恢复流程，因此不会保存损坏结果。

### 9.2 安全与权限边界

- `src/lib/translationEndpoint.ts` 统一规范化 Base URL 并公开目标主机；Settings 保存、连接测试、后台配置写入和翻译服务使用同一规则。
- 正式端点只允许 HTTPS；`localhost` 与 `127.0.0.1` 可使用 HTTP 调试，并在 Settings 中明确标记为不安全的本机连接。
- Settings 显示文章正文和划词内容的发送主机；清除 API Key 只移除本地配置中的 Key，保留模型、Base URL、文章结果与历史。
- Manifest 不再声明静态 Content Script、`<all_urls>` 或长期 Host Permission；只保留 `activeTab`、`scripting`，以及 HTTPS 和本机 HTTP 的可选 Host Permission 范围。
- `src/adapters/chromeAccess.ts` 集中处理当前标签页注入、模型主机权限检查和申请；正文提取器与模型客户端不调用权限 API。
- Settings 在保存或测试连接的用户操作中申请规范化后的单个模型主机。拒绝时不保存、不发请求，并说明重新点击操作后允许；旧配置缺少权限时，整篇与划词请求会中止并引导回 Settings。
- API Key 继续保存在扩展本地存储，不引入无法提供实际保护的固定密钥“加密”。界面必须说明数据发送目标并允许清除 Key。

### 9.3 存储与验证边界

- `src/services/storage.ts` 将完整文章按 ID 单份保存，`lastResult` 只保存 ID，`translationHistory` 只保存轻量元数据；读取 API 在返回前补全正文。
- `storageVersion` 驱动从旧完整结果结构到当前结构的单向、幂等迁移，不要求用户清空数据。
- 大字段写入前后检查 `chrome.storage.local` 容量；超限时从最旧且非当前的历史开始清理。新结果仍无法写入时保持原最近结果，并向 Reader 或 Popup 返回可操作错误。
- Vitest 验证纯函数、服务和状态；Chrome E2E 使用独立本地假模型，不将 E2E 依赖引入生产代码。
- `e2e/` 使用 Playwright 启动临时 Chromium 配置并加载 `dist/`，测试服务器只监听 `127.0.0.1`，浏览器测试路由拒绝其他 HTTP(S) 请求。
- 本地假 OpenAI 端点同时实现普通响应和 SSE 流，长文章夹具验证多段请求；测试从生产页面覆盖设置、权限、提取、阅读、划词、历史、复制和下载。
- 无头 Chromium 的原生权限气泡不可操作，因此夹具通过 `chrome://extensions` 的浏览器级接口模拟用户允许，再由 Settings 实际执行并校验 `permissions.request()`；不修改生产权限适配器。
- `public/manifest.json` 将后台声明为模块 Service Worker，以匹配 Vite 生产构建的 ESM 分块；E2E 失败会在 `test-results/e2e/` 保留截图和 trace，CI 同步上传该目录。
- Task 25 的真实模型验收不提交密钥、页面快照或下载结果。2026-09-20 的本地 Ollama 复验确认校验器能阻止损坏结果，但候选模型未稳定通过五站清单；最终仍需使用满足标记协议的个人 OpenAI 兼容配置复验。

## 10. 继续暂缓的技术设计

以下内容只有在个人试用证明有必要时才重新评估：

- 原文与译文逐段对齐编辑。
- IndexedDB 和大量历史数据。
- 并发翻译、后台请求租约和跨设备恢复。
- 缓存指纹、收藏、搜索和术语表。
- 多服务商抽象和跨浏览器 E2E 矩阵。
