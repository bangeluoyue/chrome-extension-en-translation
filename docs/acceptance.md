# 验收记录

> 本文保留任务 16 的 Demo 基线，并追加后续自动化验收；最终人工验收仍以 [task.md](./task.md) 为准。

验收日期：2026-09-11。真实页面 HTML 保存为临时快照后，使用项目内的 `extractArticle` 直接提取；快照未提交仓库。

## 真实网站抽取

| 网站 | 页面 | Markdown 字符数 | 已覆盖结构 |
|------|------|----------------:|------------|
| MDN | [JavaScript execution model](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model) | 26,346 | 标题、代码、表格、图片 |
| React | [Thinking in React](https://react.dev/learn/thinking-in-react) | 22,295 | 标题、代码、图片 |
| web.dev | [Optimize Largest Contentful Paint](https://web.dev/articles/optimize-lcp) | 32,900 | 长文、代码、表格、多图 |
| Node.js | [The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) | 19,004 | 标题、多个代码块 |
| GitHub Docs | [Organizing information with tables](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-tables) | 4,326 | 代码、表格、图片 |

五个页面均得到非空标题、正确来源 URL 和超过 200 字符的 Markdown。

## 边界与主流程

- 合成用例覆盖空内容提示、超长标题、代码块、GFM 表格、懒加载图片，以及 500 段超长正文不截断。
- Vitest 覆盖设置回填与连接测试、流式翻译和取消、三种阅读模式、划词翻译、最近 20 篇历史、复制与下载。
- 长标题和来源可断行；图片限制为容器宽度；代码块和表格在窄侧边栏中横向滚动。

## 验证命令与手动复验

```bash
npm run check
```

生产构建后加载 `dist/`：先在 Settings 填入个人 OpenAI 兼容配置并测试连接，再从 Popup 翻译上述任一文章；随后切换阅读模式、右键翻译选区，并检查历史、复制与下载。自动化测试使用 Mock，不会发出真实模型请求或写入个人凭据。

## Task 24 无密钥 Chrome E2E

验收日期：2026-09-19。`e2e/` 中的 Playwright 用例加载生产 `dist/`，每次创建全新 Chromium 配置，并连接仅监听 `127.0.0.1` 的假 OpenAI 兼容服务。测试路由会阻止其他 HTTP(S) 请求，使用的 API Key 为无效占位值。

自动化链路覆盖：Settings 缺失/获得端点权限、连接测试与保存；Popup 对本机长文章的真实脚本注入和正文提取；至少两个 SSE 分段请求；结果页三种阅读模式；Side Panel 划词翻译、复制和历史回看；双语 Markdown 复制与下载。历史回看不会再次请求模型，下载内容同时包含原文与译文标记。

```bash
npm run test:e2e:install # 首次安装项目隔离的 Chromium
npm run test:e2e         # 构建并运行全新配置的核心闭环
```

Task 24 基线为 1 个 E2E 用例通过，运行约 6 秒。失败时 Playwright 将整页截图和 trace 写入 `test-results/e2e/`，CI 会上传该目录。E2E 首次运行还发现并修复了生产后台缺少模块声明、导致 Vite ESM Service Worker 未注册消息监听器的问题。

## Task 25 真实模型复验（未通过）

验收日期：2026-09-20。生产 `dist/` 加载到全新 Chromium 153 配置，模型端点为仅监听 `127.0.0.1:11435` 的 Ollama OpenAI 兼容接口，凭据使用无效占位值且未提交。系统 Google Chrome 152 的自动化启动会忽略命令行侧载扩展，因此可重复流程使用项目隔离 Chromium；品牌版 Chrome 仍需按 README 手动加载 `dist/`。

| 网站 | 字符数 | 结构 | 生产扩展提取 |
|------|-------:|------|----------------|
| MDN · JavaScript execution model | 26,346 | 6 个代码围栏、64 个链接 | 通过 |
| React · Thinking in React | 22,295 | 6 个代码围栏、9 个链接 | 通过 |
| web.dev · Optimize LCP | 32,900 | 长文章、3 个代码围栏、65 个链接 | 通过 |
| Node.js · Event Loop | 20,453 | 17 个链接 | 通过 |
| GitHub Docs · Tables | 4,326 | 5 个代码围栏、12 个链接 | 通过 |

Settings 的本机 HTTP 连接测试、模型 Host Permission 申请、当前站点按需权限和 Popup 脚本注入均在真实扩展环境通过。HTTPS/非本机 HTTP 规则、权限允许/拒绝、取消恢复、结构异常、旧存储迁移、容量处理和输出格式继续由聚焦 Vitest 与 Task 24 E2E 覆盖。

真实翻译使用 `qwen2.5` 0.5B、1.5B、3B 和 7B（含 32K 上下文确定性配置）复验。模型会删除、重复、重排或改写保护标记；扩展均显示“Markdown 结构校验失败”、保留原文、禁用输出且不保存损坏结果。3B 在 GitHub Docs 上曾单次显示完成并解锁下载，但后续四次连续重试失败，不能作为稳定通过。针对该阻断，单段提示已增加完整翻译要求和逐段标记清单，并有回归测试；响应校验没有放宽。

因此以下人工项仍未通过：五站完整真实翻译、web.dev 超长文真实模型取消后恢复，以及五站完成结果的真实输出文件检查。Task 25 必须保持未完成；复验需要一个能稳定逐字保留全部保护标记的个人 OpenAI 兼容模型配置。不得用假模型 E2E 或偶发成功替代此项。

回归结果：`npm run check` 通过（22 个测试文件、127 个测试、类型检查与生产构建），`npm run test:e2e` 通过（1 个生产扩展闭环）。构建仍只有应用分块超过 500 kB 的既有非阻断警告。
