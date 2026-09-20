# AI 双语文章阅读助手

基于 React、TypeScript 和 Chrome Manifest V3 的英文网页翻译扩展。它使用 Readability 提取正文，通过 OpenAI 兼容接口流式翻译，并在 Side Panel 或独立结果页中提供原文、译文和双语阅读。

## 项目状态

Demo 阶段（任务 00～16）及稳定性任务 17～24 已经完成。任务 25 已开始真实浏览器与本地模型复验，但五站完整翻译尚未稳定通过；具体阻断与复验条件见 [验收记录](./docs/acceptance.md)。

## 主要能力

- 一键提取并翻译当前文章；正文提取仅在用户点击后注入，扩展不再长期读取所有网站。
- 长文章按结构块串行请求，显示真实分段进度，并可从已完成段之后继续。
- 翻译前保护代码与链接目标，结构校验失败时停在当前段，避免保存损坏的 Markdown。
- 右键翻译选中文字，不覆盖整篇文章结果。
- 保存最近 20 篇结果，支持打开和删除。
- 完整文章按 ID 单份存储；旧历史自动迁移，容量紧张时优先清理最旧记录并保留可复制、下载的当前译文。
- 复制仅译文或双语 Markdown，并下载带来源信息的双语文件。
- 自由配置 API Key、模型和 Base URL，保存前可测试连接；正式端点仅允许 HTTPS，设置页会显示数据发送主机、按需申请该主机权限并可清除 Key。

## 本地开发

```bash
npm install
npm run dev
npm run check
npm run test:e2e:install
npm run test:e2e
```

`npm run check` 会依次执行类型检查、Vitest 测试和生产构建。首次运行 E2E 前用 `npm run test:e2e:install` 安装项目隔离的 Chromium；此后 `npm run test:e2e` 会构建生产扩展，并在全新临时配置中连接本机假 OpenAI 服务跑通核心闭环，不需要真实密钥或公网。失败截图和追踪保存在 `test-results/e2e/`。

手动试用时运行 `npm run build`，然后在 `chrome://extensions` 开启开发者模式并加载生成的 `dist/`。API Key 只存放在本机的 `chrome.storage.local`，不要提交真实凭据。

## 项目文档

- [需求说明](./docs/proposal.md)
- [技术设计](./docs/design.md)
- [页面布局](./docs/layouts/README.md)
- [任务清单](./docs/task.md)
- [验收记录](./docs/acceptance.md)
