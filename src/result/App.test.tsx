import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertModelEndpointPermission } from '../adapters/chromeAccess'
import {
  loadLastResult,
  loadPendingTranslation,
  loadTranslationProgress,
  loadUserConfig,
  persistCompletedTranslation,
  persistTranslationProgress,
  removePendingTranslation,
  removeTranslationProgress,
} from '../services/storageClient'
import { createArticleTranslationRun } from '../services/articleTranslation'
import {
  STORAGE_CAPACITY_ERROR_MESSAGE,
  type TranslationProgress,
  type TranslationResult,
} from '../types'
import { copyTextToClipboard } from '../utils/clipboard'
import { downloadMarkdown } from '../utils/downloadMarkdown'
import { playTypewriterStream } from '../utils/typewriter'
import { LONG_ARTICLE_CHARACTER_THRESHOLD } from '../lib/articleSizePreflight'
import App from './App'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('../adapters/chromeAccess', () => ({
  assertModelEndpointPermission: vi.fn(),
}))

vi.mock('md-wx', () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}))

vi.mock('../services/storageClient', () => ({
  loadLastResult: vi.fn(),
  loadPendingTranslation: vi.fn(),
  loadTranslationProgress: vi.fn(),
  loadUserConfig: vi.fn(),
  persistCompletedTranslation: vi.fn(),
  persistTranslationProgress: vi.fn(),
  removePendingTranslation: vi.fn(),
  removeTranslationProgress: vi.fn(),
}))

vi.mock('../services/translation', () => ({
  getTranslationErrorInfo: vi.fn((error: unknown) =>
    error instanceof Error && error.message.startsWith('未获得模型端点访问权限')
      ? { message: error.message, action: 'settings' }
      : { message: '翻译失败', action: 'retry' },
  ),
}))

vi.mock('../services/articleTranslation', () => ({
  createArticleTranslationRun: vi.fn(),
}))

vi.mock('../utils/typewriter', () => ({
  playTypewriterStream: vi.fn(),
}))

vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn(),
}))

vi.mock('../utils/downloadMarkdown', () => ({
  downloadMarkdown: vi.fn(),
}))

const loadLastResultMock = vi.mocked(loadLastResult)
const assertModelEndpointPermissionMock = vi.mocked(assertModelEndpointPermission)
const loadPendingTranslationMock = vi.mocked(loadPendingTranslation)
const loadTranslationProgressMock = vi.mocked(loadTranslationProgress)
const loadUserConfigMock = vi.mocked(loadUserConfig)
const persistCompletedTranslationMock = vi.mocked(persistCompletedTranslation)
const persistTranslationProgressMock = vi.mocked(persistTranslationProgress)
const removePendingTranslationMock = vi.mocked(removePendingTranslation)
const removeTranslationProgressMock = vi.mocked(removeTranslationProgress)
const createArticleTranslationRunMock = vi.mocked(createArticleTranslationRun)
const playTypewriterStreamMock = vi.mocked(playTypewriterStream)
const copyTextToClipboardMock = vi.mocked(copyTextToClipboard)
const downloadMarkdownMock = vi.mocked(downloadMarkdown)

let root: Root | null = null

beforeEach(() => {
  vi.clearAllMocks()
  assertModelEndpointPermissionMock.mockResolvedValue(undefined)
  loadLastResultMock.mockResolvedValue(null)
  loadPendingTranslationMock.mockResolvedValue({
    title: 'History Article',
    author: 'Author',
    sourceUrl: 'https://example.com/history',
    originalMarkdown: '# Original',
    createdAt: 1,
  })
  loadUserConfigMock.mockResolvedValue({
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'https://example.com/v1',
  })
  loadTranslationProgressMock.mockResolvedValue(null)
  persistCompletedTranslationMock.mockResolvedValue({ removedHistoryCount: 0 })
  persistTranslationProgressMock.mockResolvedValue(undefined)
  removePendingTranslationMock.mockResolvedValue(undefined)
  removeTranslationProgressMock.mockResolvedValue(undefined)
  createArticleTranslationRunMock.mockReturnValue({
    stream: emptyStream(),
    initialMarkdown: '',
    segmentCount: 1,
    completedSegmentCount: 0,
    resumeAccepted: false,
  })
  playTypewriterStreamMock.mockResolvedValue('# 完成译文')
  copyTextToClipboardMock.mockResolvedValue(undefined)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.replaceChildren()
})

describe('completed article persistence', () => {
  it('saves the completed result once through the durable storage operation', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App />)
      await flushPromises()
    })

    expect(persistCompletedTranslationMock).toHaveBeenCalledOnce()
    expect(persistCompletedTranslationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'History Article',
        translatedMarkdown: '# 完成译文',
      }),
    )
    expect(removePendingTranslationMock).not.toHaveBeenCalled()
    expect(removeTranslationProgressMock).not.toHaveBeenCalled()
  })

  it('reports automatic history cleanup without interrupting reading', async () => {
    persistCompletedTranslationMock.mockResolvedValueOnce({ removedHistoryCount: 2 })
    playTypewriterStreamMock.mockImplementationOnce(async (_stream, onUpdate) => {
      onUpdate('# 完成译文')
      return '# 完成译文'
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App />)
      await flushPromises()
    })

    expect(container.textContent).toContain('已自动清理 2 条较早历史记录')
    expect(container.textContent).toContain('# 完成译文')
  })

  it('keeps the completed text usable when capacity prevents saving', async () => {
    persistCompletedTranslationMock.mockRejectedValueOnce(
      new Error(STORAGE_CAPACITY_ERROR_MESSAGE),
    )
    playTypewriterStreamMock.mockImplementationOnce(async (_stream, onUpdate) => {
      onUpdate('# 完成译文')
      return '# 完成译文'
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App />)
      await flushPromises()
    })

    expect(container.textContent).toContain('译文已生成但未保存')
    expect(container.textContent).toContain('请先复制或下载当前译文')
    expect(findButton(container, '复制 ▾')?.disabled).toBe(false)
    expect(findButton(container, '下载')?.disabled).toBe(false)
  })

  it('stops before model requests and directs missing endpoint permission to Settings', async () => {
    assertModelEndpointPermissionMock.mockRejectedValueOnce(
      new Error(
        '未获得模型端点访问权限（example.com），请打开设置页，点击保存或测试连接后允许访问',
      ),
    )
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App />)
      await flushPromises()
    })

    expect(container.textContent).toContain('请打开设置页')
    expect(findButton(container, '检查设置')).toBeTruthy()
    expect(createArticleTranslationRunMock).not.toHaveBeenCalled()
  })

  it('opens a saved history result without loading config or requesting a translation', async () => {
    const savedResult: TranslationResult = {
      title: 'Saved Article',
      author: 'Saved Author',
      sourceUrl: 'https://example.com/saved',
      originalMarkdown: '# Saved original',
      translatedMarkdown: '# 已保存译文',
      createdAt: 2,
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App savedResult={savedResult} />)
      await flushPromises()
    })

    expect(container.textContent).toContain('Saved Article')
    expect(container.textContent).toContain('# 已保存译文')
    expect(container.textContent).toContain('已打开历史翻译')
    expect(loadLastResultMock).not.toHaveBeenCalled()
    expect(loadPendingTranslationMock).not.toHaveBeenCalled()
    expect(loadUserConfigMock).not.toHaveBeenCalled()
    expect(createArticleTranslationRunMock).not.toHaveBeenCalled()
    expect(persistCompletedTranslationMock).not.toHaveBeenCalled()
    expect(getButton(container, '← 关闭')).toBeTruthy()
    expect(findButton(container, '设置')).toBeUndefined()
    expect(container.querySelector<HTMLAnchorElement>('.result__source-link')?.href).toBe(
      savedResult.sourceUrl,
    )
  })

  it('keeps only Side Panel navigation beside the shared reading actions', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App surface="sidepanel" savedResult={createSavedResult()} />)
      await flushPromises()
    })

    expect(findButton(container, '← 关闭')).toBeUndefined()
    expect(getButton(container, '设置')).toBeTruthy()
    expect(getButton(container, '复制 ▾')).toBeTruthy()
    expect(getButton(container, '下载')).toBeTruthy()
    expect(container.querySelector<HTMLAnchorElement>('.result__source-link')?.href).toBe(
      'https://example.com/saved',
    )
  })

  it('copies translation-only and bilingual Markdown independently of reading mode', async () => {
    const savedResult = createSavedResult()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App savedResult={savedResult} />)
      await flushPromises()
    })

    await act(async () => {
      getButton(container, '仅原文').click()
    })

    await act(async () => {
      getButton(container, '复制 ▾').click()
    })

    await act(async () => {
      getButton(container, '仅译文 Markdown').click()
      await flushPromises()
    })

    expect(copyTextToClipboardMock).toHaveBeenLastCalledWith(
      '# Saved Article\n\n> **作者**：Saved Author\n> **原文链接**：https://example.com/saved\n\n# 已保存译文',
    )
    expect(getButton(container, '已复制译文')).toBeTruthy()

    await act(async () => {
      getButton(container, '已复制译文').click()
    })

    await act(async () => {
      getButton(container, '双语 Markdown').click()
      await flushPromises()
    })

    expect(copyTextToClipboardMock).toHaveBeenLastCalledWith(
      '# Saved Article\n\n> **作者**：Saved Author\n> **原文链接**：https://example.com/saved\n\n## 原文\n\n# Saved original\n\n## 译文\n\n# 已保存译文',
    )
    expect(getButton(container, '已复制双语')).toBeTruthy()
  })

  it('shows feedback when copying Markdown fails', async () => {
    copyTextToClipboardMock.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App savedResult={createSavedResult()} />)
      await flushPromises()
    })

    await act(async () => {
      getButton(container, '复制 ▾').click()
    })

    await act(async () => {
      getButton(container, '双语 Markdown').click()
      await flushPromises()
    })

    expect(getButton(container, '复制失败')).toBeTruthy()
  })

  it('downloads the same complete bilingual Markdown produced by the shared formatter', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App savedResult={createSavedResult()} />)
      await flushPromises()
    })

    await act(async () => {
      getButton(container, '下载').click()
    })

    expect(downloadMarkdownMock).toHaveBeenCalledWith(
      '# Saved Article\n\n> **作者**：Saved Author\n> **原文链接**：https://example.com/saved\n\n## 原文\n\n# Saved original\n\n## 译文\n\n# 已保存译文',
      'Saved Article',
    )
    expect(getButton(container, '已下载')).toBeTruthy()
  })
})

describe('article size preflight', () => {
  it('shows concise size feedback for an ordinary article', async () => {
    const savedResult = createSavedResult()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App surface="sidepanel" savedResult={savedResult} />)
      await flushPromises()
    })

    const preflight = container.querySelector<HTMLElement>('.result__preflight')
    expect(preflight?.textContent).toContain('16 个字符 · 普通文章 · 1 个 Markdown 块')
    expect(preflight?.textContent).not.toContain('模型上下文限制')
    expect(preflight?.classList.contains('result__preflight--warning')).toBe(false)
  })

  it('warns that a long article will be translated in structural segments', async () => {
    const originalMarkdown = 'a'.repeat(LONG_ARTICLE_CHARACTER_THRESHOLD + 1)
    loadPendingTranslationMock.mockResolvedValue({
      title: 'Long Article',
      author: 'Author',
      sourceUrl: 'https://example.com/long',
      originalMarkdown,
      createdAt: 2,
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App />)
      await flushPromises()
    })

    const preflight = container.querySelector<HTMLElement>('.result__preflight')
    expect(preflight?.textContent).toContain('30,001 个字符 · 长文章 · 1 个 Markdown 块')
    expect(preflight?.textContent).toContain('将按 Markdown 结构顺序分段翻译')
    expect(preflight?.classList.contains('result__preflight--warning')).toBe(true)
    expect(createArticleTranslationRunMock).toHaveBeenCalledOnce()
    expect(createArticleTranslationRunMock).toHaveBeenCalledWith(
      originalMarkdown,
      expect.any(Object),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        resume: null,
        onProgress: expect.any(Function),
      }),
    )
  })
})

describe('segmented translation progress', () => {
  it('restores completed segments for the same pending article', async () => {
    const storedProgress: TranslationProgress = {
      sourceUrl: 'https://example.com/history',
      articleCreatedAt: 1,
      segmentCount: 3,
      completedSegments: ['第一段'],
      updatedAt: 2,
    }
    loadTranslationProgressMock.mockResolvedValue(storedProgress)
    createArticleTranslationRunMock.mockReturnValue({
      stream: emptyStream(),
      initialMarkdown: '第一段',
      segmentCount: 3,
      completedSegmentCount: 1,
      resumeAccepted: true,
    })
    playTypewriterStreamMock.mockResolvedValue('第一段\n\n第二段\n\n第三段')
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App surface="sidepanel" />)
      await flushPromises()
    })

    expect(createArticleTranslationRunMock).toHaveBeenCalledWith(
      '# Original',
      expect.any(Object),
      expect.objectContaining({
        resume: {
          segmentCount: 3,
          completedSegments: ['第一段'],
        },
      }),
    )
    expect(playTypewriterStreamMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ initialText: '第一段' }),
    )
  })

  it('shows the failed segment and keeps completed segments available to continue', async () => {
    createArticleTranslationRunMock.mockImplementation((_markdown, _config, options) => ({
      stream: (async function* () {
        await options?.onProgress?.({
          phase: 'translating',
          currentSegment: 1,
          segmentCount: 3,
          completedSegmentCount: 0,
          completedSegments: [],
        })
        yield '第一段'
        await options?.onProgress?.({
          phase: 'completed',
          currentSegment: 1,
          segmentCount: 3,
          completedSegmentCount: 1,
          completedSegments: ['第一段'],
        })
        await options?.onProgress?.({
          phase: 'translating',
          currentSegment: 2,
          segmentCount: 3,
          completedSegmentCount: 1,
          completedSegments: ['第一段'],
        })
        throw new Error('第二段失败')
      })(),
      initialMarkdown: '',
      segmentCount: 3,
      completedSegmentCount: 0,
      resumeAccepted: false,
    }))
    playTypewriterStreamMock.mockImplementation(async (stream, onUpdate, options) => {
      let output = options?.initialText ?? ''

      for await (const chunk of stream) {
        output += chunk
        onUpdate(output)
      }

      return output
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App surface="sidepanel" />)
      await flushPromises()
    })

    expect(container.textContent).toContain('第 2/3 段翻译失败，已完成 1/3 段')
    expect(container.textContent).toContain('第一段')
    expect(getButton(container, '继续翻译')).toBeTruthy()
    expect(getButton(container, '重新翻译')).toBeTruthy()
    expect(persistTranslationProgressMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://example.com/history',
        articleCreatedAt: 1,
        segmentCount: 3,
        completedSegments: ['第一段'],
      }),
    )
    expect(persistCompletedTranslationMock).not.toHaveBeenCalled()

    const clearCountBeforeRetranslate = removeTranslationProgressMock.mock.calls.length

    await act(async () => {
      getButton(container, '重新翻译').click()
      await flushPromises()
    })

    expect(removeTranslationProgressMock.mock.calls.length).toBeGreaterThan(
      clearCountBeforeRetranslate,
    )
    expect(createArticleTranslationRunMock).toHaveBeenCalledTimes(2)
    expect(createArticleTranslationRunMock.mock.calls[1][2]).toEqual(
      expect.objectContaining({ resume: null }),
    )
  })

  it('clears a pending checkpoint when opening a saved result', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App savedResult={createSavedResult()} />)
      await flushPromises()
    })

    expect(removeTranslationProgressMock).toHaveBeenCalledOnce()
  })

  it('keeps completed segments and offers continue after cancellation', async () => {
    createArticleTranslationRunMock.mockImplementation((_markdown, _config, options) => ({
      stream: (async function* () {
        await options?.onProgress?.({
          phase: 'translating',
          currentSegment: 1,
          segmentCount: 3,
          completedSegmentCount: 0,
          completedSegments: [],
        })
        yield '第一段'
        await options?.onProgress?.({
          phase: 'completed',
          currentSegment: 1,
          segmentCount: 3,
          completedSegmentCount: 1,
          completedSegments: ['第一段'],
        })
        await options?.onProgress?.({
          phase: 'translating',
          currentSegment: 2,
          segmentCount: 3,
          completedSegmentCount: 1,
          completedSegments: ['第一段'],
        })
        await waitForAbort(options?.signal)
      })(),
      initialMarkdown: '',
      segmentCount: 3,
      completedSegmentCount: 0,
      resumeAccepted: false,
    }))
    playTypewriterStreamMock.mockImplementation(async (stream, onUpdate, options) => {
      let output = options?.initialText ?? ''

      for await (const chunk of stream) {
        output += chunk
        onUpdate(output)
      }

      return output
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<App surface="sidepanel" />)
      await flushPromises()
    })

    expect(container.textContent).toContain('正在翻译第 2/3 段')

    await act(async () => {
      getButton(container, '取消').click()
      await flushPromises()
    })

    expect(container.textContent).toContain('翻译已取消，已完成 1/3 段')
    expect(container.textContent).toContain('第一段')
    expect(getButton(container, '继续翻译')).toBeTruthy()
    expect(getButton(container, '重新翻译')).toBeTruthy()
  })
})

async function* emptyStream(): AsyncGenerator<string> {
  return
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
  }
}

function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
}

function getButton(container: HTMLDivElement, label: string): HTMLButtonElement {
  const button = findButton(container, label)

  if (!button) {
    throw new Error(`未找到按钮：${label}`)
  }

  return button
}

function findButton(container: HTMLDivElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
}

function createSavedResult(): TranslationResult {
  return {
    title: 'Saved Article',
    author: 'Saved Author',
    sourceUrl: 'https://example.com/saved',
    originalMarkdown: '# Saved original',
    translatedMarkdown: '# 已保存译文',
    createdAt: 2,
  }
}
