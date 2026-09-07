import OpenAI from 'openai'
import type { UserConfig } from '../types'

// 创建 OpenAI SDK 客户端，指向兼容端点（默认 Qwen / DashScope）。
// 翻译流式请求在常驻前端上下文（Popup/结果页）中发起，
// 需显式开启浏览器环境支持（dangerouslyAllowBrowser）。
export function createOpenAIClient(config: UserConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    dangerouslyAllowBrowser: true,
  })
}
