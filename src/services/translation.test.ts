import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIClient } from '../lib/openai'
import type { UserConfig } from '../types'
import {
  getTranslationErrorInfo,
  testTranslationConnection,
  translateSelectionText,
  translateMarkdownStream,
} from './translation'

vi.mock('../lib/openai', () => ({
  createOpenAIClient: vi.fn(),
}))

const createCompletion = vi.fn()
const config: UserConfig = {
  apiKey: 'test-key',
  model: 'test-model',
  baseUrl: 'https://example.com/v1',
}

describe('translateMarkdownStream', () => {
  beforeEach(() => {
    createCompletion.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: '译文' } }] }
      },
    })

    vi.mocked(createOpenAIClient).mockReturnValue({
      chat: { completions: { create: createCompletion } },
    } as unknown as ReturnType<typeof createOpenAIClient>)
  })

  it('passes the cancellation signal to the model request', async () => {
    const controller = new AbortController()
    const chunks: string[] = []

    for await (const chunk of translateMarkdownStream('# Article', config, controller.signal)) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['译文'])
    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model', stream: true }),
      { signal: controller.signal },
    )
    const request = createCompletion.mock.calls[0][0]
    expect(request.messages[0]).toEqual({
      role: 'system',
      content: expect.stringContaining('受保护标记'),
    })
  })

  it('lists every protected marker in the system prompt for exact preservation', async () => {
    const markdown = 'Run ⟦MDP2_0000⟧, then open [Docs](⟦MDP2_0001⟧).'

    await collectStream(translateMarkdownStream(markdown, config))

    const request = createCompletion.mock.calls[0][0]
    expect(request.messages[0].content).toContain(
      '本段包含 2 个不同的受保护标记',
    )
    expect(request.messages[0].content).toContain(
      '⟦MDP2_0000⟧ ⟦MDP2_0001⟧',
    )
    expect(request.messages[1]).toEqual({ role: 'user', content: markdown })
  })
})

describe('testTranslationConnection', () => {
  beforeEach(() => {
    createCompletion.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] })
    vi.mocked(createOpenAIClient).mockReturnValue({
      chat: { completions: { create: createCompletion } },
    } as unknown as ReturnType<typeof createOpenAIClient>)
  })

  it('sends a minimal non-streaming request with the current model', async () => {
    await testTranslationConnection(config)

    expect(createCompletion).toHaveBeenCalledWith({
      model: 'test-model',
      stream: false,
      max_tokens: 1,
      messages: [{ role: 'user', content: '请只回复 OK' }],
    })
  })
})

describe('translateSelectionText', () => {
  beforeEach(() => {
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: '  浏览器会解析 HTML。  ' } }],
    })
    vi.mocked(createOpenAIClient).mockReturnValue({
      chat: { completions: { create: createCompletion } },
    } as unknown as ReturnType<typeof createOpenAIClient>)
  })

  it('translates trimmed source text and returns a concise response', async () => {
    const controller = new AbortController()

    await expect(
      translateSelectionText('  The browser parses HTML.  ', config, controller.signal),
    ).resolves.toBe('浏览器会解析 HTML。')
    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        stream: false,
        messages: expect.arrayContaining([
          { role: 'user', content: 'The browser parses HTML.' },
        ]),
      }),
      { signal: controller.signal },
    )
  })

  it('rejects empty source text before creating a model client', async () => {
    await expect(translateSelectionText('   ', config)).rejects.toThrow('划词内容为空')
    expect(createOpenAIClient).not.toHaveBeenCalled()
  })
})

describe('getTranslationErrorInfo', () => {
  it.each([
    ['未配置 API Key，请先设置', 'settings', '未配置 API Key'],
    [
      '未获得模型端点访问权限（example.com），请打开设置页',
      'settings',
      '未获得模型端点访问权限',
    ],
    ['本地存储空间不足；请删除较早历史后重试', 'retry', '本地存储空间不足'],
    ['401 Unauthorized', 'settings', 'API Key 无效'],
    ['404 model_not_found', 'settings', '模型名称或 Base URL'],
    ['Failed to fetch', 'retry', '网络异常'],
    ['429 rate limit', 'retry', '请求过于频繁'],
  ] as const)('classifies %s', (message, action, expectedText) => {
    expect(getTranslationErrorInfo(new Error(message))).toEqual({
      action,
      message: expect.stringContaining(expectedText),
    })
  })
})

describe('translation endpoint safety', () => {
  it('blocks non-local HTTP before any article, selection, or connection request', async () => {
    const insecureConfig: UserConfig = {
      ...config,
      baseUrl: 'http://api.example.com/v1',
    }
    vi.mocked(createOpenAIClient).mockClear()

    await expect(testTranslationConnection(insecureConfig)).rejects.toThrow(
      'Base URL 必须使用 HTTPS',
    )
    await expect(
      translateSelectionText('Selected text', insecureConfig),
    ).rejects.toThrow('Base URL 必须使用 HTTPS')
    await expect(
      collectStream(translateMarkdownStream('# Article', insecureConfig)),
    ).rejects.toThrow('Base URL 必须使用 HTTPS')
    expect(createOpenAIClient).not.toHaveBeenCalled()
  })
})

async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  let output = ''

  for await (const chunk of stream) {
    output += chunk
  }

  return output
}
