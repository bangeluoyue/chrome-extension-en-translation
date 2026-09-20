import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LONG_ARTICLE_CHARACTER_THRESHOLD } from '../lib/articleSizePreflight'
import type { UserConfig } from '../types'
import { translateProtectedMarkdownStream } from './protectedMarkdownTranslation'
import {
  createArticleTranslationRun,
  type ArticleTranslationProgress,
  type ArticleTranslationResume,
} from './articleTranslation'

vi.mock('./protectedMarkdownTranslation', () => ({
  translateProtectedMarkdownStream: vi.fn(),
}))

const translateProtectedMarkdownStreamMock = vi.mocked(translateProtectedMarkdownStream)
const config: UserConfig = {
  apiKey: 'test-key',
  model: 'test-model',
  baseUrl: 'https://example.com/v1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createArticleTranslationRun', () => {
  it('keeps an ordinary article as one request', async () => {
    translateProtectedMarkdownStreamMock.mockReturnValue(streamOf('译', '文'))
    const run = createArticleTranslationRun('# Article\n\nParagraph', config)

    const output = await collectStream(run.stream)

    expect(run).toMatchObject({
      initialMarkdown: '',
      segmentCount: 1,
      completedSegmentCount: 0,
      resumeAccepted: false,
    })
    expect(output).toBe('译文')
    expect(translateProtectedMarkdownStreamMock).toHaveBeenCalledOnce()
    expect(translateProtectedMarkdownStreamMock).toHaveBeenCalledWith(
      '# Article\n\nParagraph',
      config,
      undefined,
    )
  })

  it('requests long-article segments strictly in order and reports real progress', async () => {
    const markdown = createLongArticle()
    const progressEvents: ArticleTranslationProgress[] = []
    let requestIndex = 0
    let firstStreamCompleted = false

    translateProtectedMarkdownStreamMock.mockImplementation(() => {
      const currentRequestIndex = requestIndex
      requestIndex += 1

      if (currentRequestIndex > 0 && !firstStreamCompleted) {
        throw new Error('下一段在前一段完成前启动')
      }

      return (async function* () {
        try {
          yield currentRequestIndex === 0 ? '第一' : '第二'
          await Promise.resolve()
          yield '段'
        } finally {
          if (currentRequestIndex === 0) {
            firstStreamCompleted = true
          }
        }
      })()
    })

    const run = createArticleTranslationRun(markdown, config, {
      onProgress: (progress) => {
        progressEvents.push(progress)
      },
    })
    const output = await collectStream(run.stream)
    const requestedSegments = translateProtectedMarkdownStreamMock.mock.calls.map(
      ([segment]) => segment,
    )

    expect(output).toBe('第一段\n\n第二段')
    expect(requestedSegments).toHaveLength(2)
    expect(requestedSegments.join('\n\n')).toBe(markdown)
    expect(
      progressEvents.map(({ phase, currentSegment, completedSegmentCount }) => ({
        phase,
        currentSegment,
        completedSegmentCount,
      })),
    ).toEqual([
      { phase: 'translating', currentSegment: 1, completedSegmentCount: 0 },
      { phase: 'completed', currentSegment: 1, completedSegmentCount: 1 },
      { phase: 'translating', currentSegment: 2, completedSegmentCount: 1 },
      { phase: 'completed', currentSegment: 2, completedSegmentCount: 2 },
    ])
  })

  it('resumes after a middle-segment structure failure without requesting completed segments again', async () => {
    const markdown = createLongArticle()
    let checkpoint: ArticleTranslationResume | null = null
    translateProtectedMarkdownStreamMock
      .mockReturnValueOnce(streamOf('第一段'))
      .mockImplementationOnce(() => {
        throw new Error('Markdown 结构校验失败：保护标记数量不一致')
      })
    const firstRun = createArticleTranslationRun(markdown, config, {
      onProgress: (progress) => {
        if (progress.phase === 'completed') {
          checkpoint = {
            segmentCount: progress.segmentCount,
            completedSegments: [...progress.completedSegments],
          }
        }
      },
    })

    await expect(collectStream(firstRun.stream)).rejects.toThrow(
      'Markdown 结构校验失败',
    )
    expect(checkpoint).toEqual({
      segmentCount: 2,
      completedSegments: ['第一段'],
    })

    vi.clearAllMocks()
    translateProtectedMarkdownStreamMock.mockReturnValue(streamOf('第二段'))
    const resumedRun = createArticleTranslationRun(markdown, config, {
      resume: checkpoint,
    })
    const resumedOutput = await collectStream(resumedRun.stream)

    expect(resumedRun).toMatchObject({
      initialMarkdown: '第一段',
      segmentCount: 2,
      completedSegmentCount: 1,
      resumeAccepted: true,
    })
    expect(`${resumedRun.initialMarkdown}${resumedOutput}`).toBe('第一段\n\n第二段')
    expect(translateProtectedMarkdownStreamMock).toHaveBeenCalledOnce()
    expect(translateProtectedMarkdownStreamMock.mock.calls[0][0]).toContain('# Second')
    expect(translateProtectedMarkdownStreamMock.mock.calls[0][0]).not.toContain('# First')
  })

  it('ignores a checkpoint created for a different segment plan', () => {
    const run = createArticleTranslationRun('# Article', config, {
      resume: {
        segmentCount: 2,
        completedSegments: ['旧译文'],
      },
    })

    expect(run).toMatchObject({
      initialMarkdown: '',
      segmentCount: 1,
      completedSegmentCount: 0,
      resumeAccepted: false,
    })
  })

  it('does not start another segment after cancellation', async () => {
    const controller = new AbortController()
    const markdown = `# First\n\n${'a'.repeat(
      LONG_ARTICLE_CHARACTER_THRESHOLD,
    )}\n\n# Second\n\nParagraph`
    translateProtectedMarkdownStreamMock.mockReturnValue(streamOf('部分译文', '不应显示'))
    const chunks: string[] = []
    const run = createArticleTranslationRun(markdown, config, {
      signal: controller.signal,
    })

    for await (const chunk of run.stream) {
      chunks.push(chunk)
      controller.abort()
    }

    expect(chunks).toEqual(['部分译文'])
    expect(translateProtectedMarkdownStreamMock).toHaveBeenCalledOnce()
  })

  it('stops when a segment returns no translated content', async () => {
    translateProtectedMarkdownStreamMock.mockReturnValue(streamOf('   '))
    const run = createArticleTranslationRun('# Article', config)

    await expect(collectStream(run.stream)).rejects.toThrow('翻译服务未返回内容')
  })
})

function createLongArticle(): string {
  return [
    '# First',
    '',
    'a'.repeat(16_000),
    '',
    '# Second',
    '',
    'b'.repeat(16_000),
  ].join('\n')
}

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
