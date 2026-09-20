import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertModelEndpointPermission } from '../adapters/chromeAccess'
import {
  loadPendingSelection,
  loadTranslationHistory,
  loadUserConfig,
  removePendingSelection,
  removeTranslationHistoryEntry,
} from '../services/storageClient'
import { translateSelectionText } from '../services/translation'
import type { PendingSelection, TranslationHistoryEntry, TranslationResult } from '../types'
import { copyTextToClipboard } from '../utils/clipboard'
import App from './App'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('../adapters/chromeAccess', () => ({
  assertModelEndpointPermission: vi.fn(),
}))

vi.mock('../result/App', () => ({
  default: ({
    headerAction,
    savedResult,
    topContent,
  }: {
    headerAction?: ReactNode
    savedResult?: TranslationResult | null
    topContent?: ReactNode
  }) => (
    <main>
      <div className="reader-header-action">{headerAction}</div>
      <div data-testid="article-content">
        {savedResult === undefined ? '已有文章内容' : savedResult?.title || '暂无文章内容'}
      </div>
      {topContent}
    </main>
  ),
}))

vi.mock('../services/storageClient', () => ({
  loadPendingSelection: vi.fn(),
  loadTranslationHistory: vi.fn(),
  loadUserConfig: vi.fn(),
  removePendingSelection: vi.fn(),
  removeTranslationHistoryEntry: vi.fn(),
}))

vi.mock('../services/translation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/translation')>()
  return { ...actual, translateSelectionText: vi.fn() }
})

vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn(),
}))

const loadPendingSelectionMock = vi.mocked(loadPendingSelection)
const assertModelEndpointPermissionMock = vi.mocked(assertModelEndpointPermission)
const loadTranslationHistoryMock = vi.mocked(loadTranslationHistory)
const loadUserConfigMock = vi.mocked(loadUserConfig)
const removePendingSelectionMock = vi.mocked(removePendingSelection)
const removeTranslationHistoryEntryMock = vi.mocked(removeTranslationHistoryEntry)
const translateSelectionTextMock = vi.mocked(translateSelectionText)
const copyTextToClipboardMock = vi.mocked(copyTextToClipboard)
const initialSelection: PendingSelection = {
  sourceText: 'The browser parses HTML.',
  pageTitle: 'Example Article',
  sourceUrl: 'https://example.com/article',
}

let root: Root | null = null

beforeEach(() => {
  vi.clearAllMocks()
  assertModelEndpointPermissionMock.mockResolvedValue(undefined)
  loadPendingSelectionMock.mockResolvedValue(initialSelection)
  loadTranslationHistoryMock.mockResolvedValue([])
  loadUserConfigMock.mockResolvedValue({
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'https://example.com/v1',
  })
  removePendingSelectionMock.mockResolvedValue(undefined)
  removeTranslationHistoryEntryMock.mockResolvedValue([])
  translateSelectionTextMock.mockReset()
  translateSelectionTextMock.mockResolvedValue('浏览器会解析 HTML。')
  copyTextToClipboardMock.mockResolvedValue(undefined)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.replaceChildren()
})

describe('Side Panel selection card', () => {
  it('shows the exact source text and page context, then closes the card', async () => {
    const container = await renderSidePanel()
    const sourceText = container.querySelector('.selection-card__text')
    const sourceLink = container.querySelector<HTMLAnchorElement>('.selection-card__source a')
    const closeButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="关闭划词翻译卡片"]',
    )

    expect(sourceText?.textContent).toBe(initialSelection.sourceText)
    expect(container.textContent).toContain(initialSelection.pageTitle)
    expect(sourceLink?.href).toBe(initialSelection.sourceUrl)

    await act(async () => {
      closeButton?.click()
      await Promise.resolve()
    })

    expect(container.querySelector('.selection-card')).toBeNull()
    expect(removePendingSelectionMock).toHaveBeenCalledOnce()
  })

  it('shows translation progress, then copies the completed translation', async () => {
    let resolveTranslation: ((translation: string) => void) | undefined
    translateSelectionTextMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveTranslation = resolve
        }),
    )

    const container = await renderSidePanel()

    expect(container.textContent).toContain('正在翻译…')
    expect(getCopyButton(container)).toBeUndefined()

    await act(async () => {
      resolveTranslation?.('浏览器会解析 HTML。')
      await flushPromises()
    })

    const copyButton = getCopyButton(container)
    expect(container.querySelector('.selection-card__translation-text')?.textContent).toBe(
      '浏览器会解析 HTML。',
    )

    await act(async () => {
      copyButton?.click()
      await flushPromises()
    })

    expect(copyTextToClipboardMock).toHaveBeenCalledWith('浏览器会解析 HTML。')
    expect(copyButton?.textContent).toBe('已复制')
  })

  it('shows a categorized translation error', async () => {
    translateSelectionTextMock.mockRejectedValue(new Error('401 Unauthorized'))
    const container = await renderSidePanel()

    expect(container.textContent).toContain('API Key 无效或已失效')
    expect(getCopyButton(container)).toBeUndefined()
  })

  it('does not translate a selection until the saved model host is allowed', async () => {
    assertModelEndpointPermissionMock.mockRejectedValueOnce(
      new Error(
        '未获得模型端点访问权限（example.com），请打开设置页，点击保存或测试连接后允许访问',
      ),
    )

    const container = await renderSidePanel()

    expect(container.textContent).toContain('请打开设置页')
    expect(container.textContent).toContain('点击保存或测试连接后允许访问')
    expect(translateSelectionTextMock).not.toHaveBeenCalled()
  })

  it('shows the latest translation history with site and time', async () => {
    const now = Date.now()
    const history: TranslationHistoryEntry[] = [
      createHistoryEntry('newer', 'Newest Article', 'https://docs.example.com/new', now),
      createHistoryEntry('older', 'Older Article', 'https://blog.example.org/old', now - 1000),
    ]
    loadTranslationHistoryMock.mockResolvedValue(history)
    const container = await renderSidePanel()

    await act(async () => {
      getButton(container, '历史').click()
      await flushPromises()
    })

    const titles = Array.from(container.querySelectorAll('.history-list__title'), (title) =>
      title.textContent?.trim(),
    )
    const metadata = Array.from(container.querySelectorAll('.history-list__meta'), (meta) =>
      meta.textContent?.trim(),
    )

    expect(container.textContent).toContain('最近阅读（2）')
    expect(titles).toEqual(['Newest Article', 'Older Article'])
    expect(metadata[0]).toContain('docs.example.com · 今天')
    expect(metadata[1]).toContain('blog.example.org · 今天')
    expect(container.querySelector<HTMLElement>('.sidepanel-reader')?.hidden).toBe(true)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.history-list__open')?.click()
    })

    expect(container.querySelector('.history-view')).toBeNull()
    expect(container.querySelector('[data-testid="article-content"]')?.textContent).toContain(
      'Newest Article',
    )

    await act(async () => {
      getButton(container, '历史').click()
    })

    await act(async () => {
      getButton(container, '← 返回阅读').click()
    })

    expect(container.querySelector('.history-view')).toBeNull()
    expect(container.querySelector<HTMLElement>('.sidepanel-reader')?.hidden).toBe(false)
  })

  it('confirms deletion and replaces a deleted current result with the latest remaining entry', async () => {
    const now = Date.now()
    const history: TranslationHistoryEntry[] = [
      createHistoryEntry('newer', 'Newest Article', 'https://example.com/new', now),
      createHistoryEntry('older', 'Older Article', 'https://example.com/old', now - 1000),
    ]
    loadPendingSelectionMock.mockResolvedValue(null)
    loadTranslationHistoryMock.mockResolvedValue(history)
    removeTranslationHistoryEntryMock.mockResolvedValue([history[1]])
    const container = await renderSidePanel()

    await act(async () => {
      getButton(container, '历史').click()
    })

    const deleteButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="删除 Newest Article"]',
    )
    await act(async () => {
      deleteButton?.click()
    })

    expect(deleteButton?.textContent).toBe('确认删除')
    expect(removeTranslationHistoryEntryMock).not.toHaveBeenCalled()

    await act(async () => {
      deleteButton?.click()
      await flushPromises()
    })

    expect(removeTranslationHistoryEntryMock).toHaveBeenCalledWith('newer')
    expect(container.textContent).not.toContain('Newest Article')
    expect(container.textContent).toContain('最近阅读（1）')

    await act(async () => {
      getButton(container, '← 返回阅读').click()
    })

    expect(container.querySelector('[data-testid="article-content"]')?.textContent).toContain(
      'Older Article',
    )
  })

  it('replaces an in-flight selection without changing the article', async () => {
    let resolveInitialTranslation: ((translation: string) => void) | undefined
    let initialSignal: AbortSignal | undefined
    translateSelectionTextMock.mockImplementation((sourceText, _config, signal) => {
      if (sourceText === initialSelection.sourceText) {
        initialSignal = signal
        return new Promise<string>((resolve) => {
          resolveInitialTranslation = resolve
        })
      }

      return Promise.resolve('更新后的译文')
    })

    const container = await renderSidePanel()
    const storageListener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0]?.[0]
    const nextSelection: PendingSelection = {
      sourceText: 'A newer selection',
      pageTitle: 'Another Article',
      sourceUrl: 'https://example.org/another',
    }

    await act(async () => {
      storageListener?.(
        { pendingSelection: { oldValue: initialSelection, newValue: nextSelection } },
        'local',
      )
      await flushPromises()
    })

    expect(initialSignal?.aborted).toBe(true)
    expect(container.querySelector('.selection-card__text')?.textContent).toBe(
      nextSelection.sourceText,
    )
    expect(container.textContent).toContain(nextSelection.pageTitle)
    expect(container.querySelector('.selection-card__translation-text')?.textContent).toBe(
      '更新后的译文',
    )
    expect(container.querySelector('[data-testid="article-content"]')?.textContent).toBe(
      '已有文章内容',
    )

    await act(async () => {
      resolveInitialTranslation?.('过期译文')
      await flushPromises()
    })

    expect(container.textContent).not.toContain('过期译文')
  })
})

async function renderSidePanel(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<App />)
    await flushPromises()
  })

  return container
}

function getCopyButton(container: HTMLDivElement): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    ['复制译文', '复制中…', '已复制', '复制失败'].includes(button.textContent ?? ''),
  )
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function getButton(container: HTMLDivElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )

  if (!button) {
    throw new Error(`未找到按钮：${label}`)
  }

  return button
}

function createHistoryEntry(
  id: string,
  title: string,
  sourceUrl: string,
  createdAt: number,
): TranslationHistoryEntry {
  return {
    id,
    title,
    author: '',
    sourceUrl,
    originalMarkdown: '# Original',
    translatedMarkdown: '# 译文',
    createdAt,
  }
}
