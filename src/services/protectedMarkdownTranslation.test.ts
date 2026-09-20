import { beforeEach, describe, expect, it, vi } from 'vitest'
import { protectMarkdownStructure } from '../lib/markdownProtection'
import type { UserConfig } from '../types'
import { translateMarkdownStream } from './translation'
import { translateProtectedMarkdownStream } from './protectedMarkdownTranslation'

vi.mock('./translation', () => ({
  translateMarkdownStream: vi.fn(),
}))

const translateMarkdownStreamMock = vi.mocked(translateMarkdownStream)
const config: UserConfig = {
  apiKey: 'test-key',
  model: 'test-model',
  baseUrl: 'https://example.com/v1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('translateProtectedMarkdownStream', () => {
  it('streams translated text while restoring protected values across chunk boundaries', async () => {
    const markdown = 'Run `npm test` and read [the guide](https://example.com/guide).'
    const protection = protectMarkdownStructure(markdown)
    const modelOutput = protection.protectedMarkdown
      .replace('Run ', '运行 ')
      .replace(' and read [the guide]', '并阅读[指南]')
    const splitIndex = modelOutput.indexOf(protection.tokens[0].marker) + 4
    const controller = new AbortController()
    translateMarkdownStreamMock.mockReturnValue(
      streamOf(modelOutput.slice(0, splitIndex), modelOutput.slice(splitIndex)),
    )

    const output = await collectStream(
      translateProtectedMarkdownStream(markdown, config, controller.signal),
    )

    expect(output).toBe('运行 `npm test`并阅读[指南](https://example.com/guide).')
    expect(translateMarkdownStreamMock).toHaveBeenCalledWith(
      protection.protectedMarkdown,
      config,
      controller.signal,
    )
  })

  it('rejects a response that deletes a protection marker', async () => {
    const markdown = 'Run `npm test`.'
    const protection = protectMarkdownStructure(markdown)
    translateMarkdownStreamMock.mockReturnValue(
      streamOf(protection.protectedMarkdown.replace(protection.tokens[0].marker, '')),
    )

    await expect(
      collectStream(translateProtectedMarkdownStream(markdown, config)),
    ).rejects.toThrow('保护标记数量不一致')
  })

  it('rejects an incomplete fence added by the model', async () => {
    translateMarkdownStreamMock.mockReturnValue(
      streamOf('翻译结果\n\n```ts\nconst value = 1'),
    )

    await expect(
      collectStream(translateProtectedMarkdownStream('Translate this.', config)),
    ).rejects.toThrow('代码围栏不完整')
  })
})

async function* streamOf(...chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk
  }
}

async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  let output = ''

  for await (const chunk of stream) {
    output += chunk
  }

  return output
}
