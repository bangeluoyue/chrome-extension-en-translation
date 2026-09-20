import type { UserConfig } from '../types'
import { createOpenAIClient } from '../lib/openai'
import { validateTranslationEndpoint } from '../lib/translationEndpoint'

// 翻译提示词：英译中，保留 Markdown 结构与图片/链接格式。
const SYSTEM_PROMPT = [
  '你是一名专业的中英文翻译，负责将英文文章翻译成简体中文。',
  '请严格遵循以下规则：',
  '1. 保留原始 Markdown 结构，包括标题、段落、列表、引用、加粗、行内代码、代码块、表格等。',
  '2. 图片链接格式 `![alt](src)` 必须原样保留，不得改动其中的 URL 与描述文字。',
  '3. 普通链接格式 `[文字](url)` 中的 URL 必须原样保留，仅翻译链接文字。',
  '4. 不要翻译代码块与行内代码中的内容。',
  '5. 受保护标记（形如 `⟦MDP0_0000⟧`）必须按原顺序逐字保留，不得删除、复制或改写。',
  '6. 仅输出翻译后的 Markdown 正文，不要添加任何解释、前言或总结。',
  '7. 必须从开头到结尾逐句完整翻译，不得删减、概括、合并或新增内容。',
].join('\n')

const CONNECTION_TEST_PROMPT = '请只回复 OK'
const SELECTION_SYSTEM_PROMPT = [
  '你是一名专业的中英文翻译。',
  '请将用户提供的文字翻译成简体中文，准确保留专有名词、代码和技术术语。',
  '仅输出简洁的译文，不要添加解释、前言、引号或总结。',
].join('\n')

export async function testTranslationConnection(config: UserConfig): Promise<void> {
  assertValidTranslationConfig(config)

  const client = createOpenAIClient(config)
  await client.chat.completions.create({
    model: config.model,
    stream: false,
    max_tokens: 1,
    messages: [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
  })
}

export async function translateSelectionText(
  sourceText: string,
  config: UserConfig,
  signal?: AbortSignal,
): Promise<string> {
  const normalizedSourceText = sourceText.trim()

  if (!normalizedSourceText) {
    throw new Error('划词内容为空，无法翻译')
  }

  assertValidTranslationConfig(config)

  const client = createOpenAIClient(config)
  const completion = await client.chat.completions.create(
    {
      model: config.model,
      stream: false,
      messages: [
        { role: 'system', content: SELECTION_SYSTEM_PROMPT },
        { role: 'user', content: normalizedSourceText },
      ],
    },
    { signal },
  )
  const translatedText = completion.choices[0]?.message.content?.trim()

  if (!translatedText) {
    throw new Error('翻译服务未返回划词译文')
  }

  return translatedText
}

// 流式翻译：逐块产出翻译增量文本，供上层累积并渲染打字机效果。
export async function* translateMarkdownStream(
  markdown: string,
  config: UserConfig,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  assertValidTranslationConfig(config)

  const client = createOpenAIClient(config)
  const systemPrompt = getMarkdownSystemPrompt(markdown)
  const stream = await client.chat.completions.create(
    {
      model: config.model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: markdown },
      ],
    },
    { signal },
  )

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content

    if (delta) {
      yield delta
    }
  }
}

function getMarkdownSystemPrompt(markdown: string): string {
  const markers = markdown.match(/⟦MDP\d+_\d{4}⟧/g) ?? []

  if (markers.length === 0) {
    return SYSTEM_PROMPT
  }

  return [
    SYSTEM_PROMPT,
    `本段包含 ${markers.length} 个不同的受保护标记；输出必须让下列每个标记恰好出现一次，且顺序不变：`,
    markers.join(' '),
    '输出前请自行核对，但不要输出核对说明。',
  ].join('\n')
}

function assertValidTranslationConfig(config: UserConfig): void {
  if (!config.apiKey.trim()) {
    throw new Error('未配置 API Key，请先在设置页填写并保存')
  }

  if (!config.model.trim()) {
    throw new Error('未配置翻译模型，请在设置页选择模型')
  }

  validateTranslationEndpoint(config.baseUrl)
}

export type TranslationErrorAction = 'settings' | 'retry'

export interface TranslationErrorInfo {
  message: string
  action: TranslationErrorAction
}

export function getTranslationErrorInfo(error: unknown): TranslationErrorInfo {
  if (!(error instanceof Error) || !error.message) {
    return { message: '翻译失败，请稍后重试', action: 'retry' }
  }

  const message = error.message
  const normalized = message.toLowerCase()

  if (
    message.startsWith('未配置') ||
    message.startsWith('Base URL') ||
    message.startsWith('未获得模型端点访问权限')
  ) {
    return { message, action: 'settings' }
  }

  if (message.includes('本地存储空间不足')) {
    return { message, action: 'retry' }
  }

  if (
    normalized.includes('401') ||
    normalized.includes('unauthorized') ||
    normalized.includes('authentication') ||
    normalized.includes('api key')
  ) {
    return { message: 'API Key 无效或已失效，请在设置页检查后重试', action: 'settings' }
  }

  if (
    normalized.includes('404') ||
    normalized.includes('model_not_found') ||
    (normalized.includes('model') &&
      (normalized.includes('not found') ||
        normalized.includes('does not exist') ||
        normalized.includes('invalid')))
  ) {
    return {
      message: '模型名称或 Base URL 不正确，请在设置页检查后重试',
      action: 'settings',
    }
  }

  if (normalized.includes('429') || normalized.includes('rate limit')) {
    return { message: '翻译请求过于频繁或额度不足，请稍后重试', action: 'retry' }
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network') ||
    normalized.includes('connection') ||
    normalized.includes('timeout')
  ) {
    return {
      message: '网络异常，无法连接翻译服务，请检查网络后重试',
      action: 'retry',
    }
  }

  return { message: `翻译失败：${message}`, action: 'retry' }
}
