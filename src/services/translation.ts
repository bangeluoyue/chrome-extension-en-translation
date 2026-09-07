import type { UserConfig } from '../types'
import { createOpenAIClient } from '../lib/openai'

// 翻译提示词：英译中，保留 Markdown 结构与图片/链接格式。
const SYSTEM_PROMPT = [
  '你是一名专业的中英文翻译，负责将英文文章翻译成简体中文。',
  '请严格遵循以下规则：',
  '1. 保留原始 Markdown 结构，包括标题、段落、列表、引用、加粗、行内代码、代码块、表格等。',
  '2. 图片链接格式 `![alt](src)` 必须原样保留，不得改动其中的 URL 与描述文字。',
  '3. 普通链接格式 `[文字](url)` 中的 URL 必须原样保留，仅翻译链接文字。',
  '4. 不要翻译代码块与行内代码中的内容。',
  '5. 仅输出翻译后的 Markdown 正文，不要添加任何解释、前言或总结。',
].join('\n')

// 流式翻译：逐块产出翻译增量文本，供上层累积并渲染打字机效果。
export async function* translateMarkdownStream(
  markdown: string,
  config: UserConfig,
): AsyncGenerator<string> {
  if (!config.apiKey.trim()) {
    throw new Error('未配置 API Key，请先在设置页填写并保存')
  }

  if (!config.model.trim()) {
    throw new Error('未配置翻译模型，请在设置页选择模型')
  }

  if (!isHttpUrl(config.baseUrl)) {
    throw new Error('Base URL 配置无效，请在设置页检查后重试')
  }

  const client = createOpenAIClient(config)
  const stream = await client.chat.completions.create({
    model: config.model,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: markdown },
    ],
  })

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content

    if (delta) {
      yield delta
    }
  }
}

export function getTranslationErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return '翻译失败，请稍后重试'
  }

  const message = error.message
  const normalized = message.toLowerCase()

  if (message.startsWith('未配置') || message.startsWith('Base URL')) {
    return message
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network') ||
    normalized.includes('connection') ||
    normalized.includes('timeout')
  ) {
    return '网络异常，无法连接翻译服务，请检查网络或 Base URL 后重试'
  }

  if (
    normalized.includes('401') ||
    normalized.includes('unauthorized') ||
    normalized.includes('authentication') ||
    normalized.includes('api key')
  ) {
    return 'API Key 无效或已失效，请在设置页检查后重试'
  }

  if (normalized.includes('429') || normalized.includes('rate limit')) {
    return '翻译请求过于频繁或额度不足，请稍后重试'
  }

  return `翻译失败：${message}`
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
