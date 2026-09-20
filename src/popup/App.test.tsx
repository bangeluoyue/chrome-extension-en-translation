import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractArticleFromActiveTab } from '../services/extraction'
import {
  loadLastResult,
  loadUserConfig,
  persistPendingTranslation,
} from '../services/storageClient'
import { openExtensionPage, openReadingWorkspace } from '../utils/navigation'
import { STORAGE_CAPACITY_ERROR_MESSAGE } from '../types'
import App from './App'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('../services/extraction', () => ({
  extractArticleFromActiveTab: vi.fn(),
}))

vi.mock('../services/storageClient', () => ({
  loadLastResult: vi.fn(),
  loadUserConfig: vi.fn(),
  persistPendingTranslation: vi.fn(),
}))

vi.mock('../utils/navigation', () => ({
  openExtensionPage: vi.fn(),
  openReadingWorkspace: vi.fn(),
}))

const extractArticleFromActiveTabMock = vi.mocked(extractArticleFromActiveTab)
const loadLastResultMock = vi.mocked(loadLastResult)
const loadUserConfigMock = vi.mocked(loadUserConfig)
const persistPendingTranslationMock = vi.mocked(persistPendingTranslation)
const openExtensionPageMock = vi.mocked(openExtensionPage)
const openReadingWorkspaceMock = vi.mocked(openReadingWorkspace)
const queryTabsMock = vi.mocked(
  chrome.tabs.query as (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>,
)

let root: Root | null = null

beforeEach(() => {
  vi.clearAllMocks()
  queryTabsMock.mockResolvedValue([
    {
      id: 1,
      title: 'Current Article',
      url: 'https://docs.example.com/current',
    },
  ] as chrome.tabs.Tab[])
  loadLastResultMock.mockResolvedValue({
    title: 'Latest Translation',
    author: 'Author',
    sourceUrl: 'https://blog.example.org/latest',
    originalMarkdown: '# Original body',
    translatedMarkdown: '# 已翻译正文',
    createdAt: 1,
  })
  loadUserConfigMock.mockResolvedValue({
    apiKey: 'test-key',
    model: 'test-model',
    baseUrl: 'https://example.com/v1',
  })
  persistPendingTranslationMock.mockResolvedValue(undefined)
  openReadingWorkspaceMock.mockResolvedValue('sidepanel')
  extractArticleFromActiveTabMock.mockResolvedValue({
    title: 'Extracted Article',
    author: 'Author',
    url: 'https://docs.example.com/current',
    markdown: '# Full original Markdown',
  })
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.replaceChildren()
})

describe('Popup launcher', () => {
  it('shows only the current page, primary action, latest result, and settings', async () => {
    const container = await renderPopup()

    expect(container.textContent).toContain('Current Article')
    expect(container.textContent).toContain('docs.example.com')
    expect(container.textContent).toContain('Latest Translation')
    expect(container.querySelector('.popup__markdown')).toBeNull()
    expect(container.textContent).not.toContain('# Full original Markdown')
    expect(container.textContent).not.toContain('# Original body')
    expect(container.textContent).not.toContain('# 已翻译正文')
    expect(findButton(container, '下载 Markdown')).toBeUndefined()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.popup__recent')?.click()
      await Promise.resolve()
    })
    expect(openReadingWorkspaceMock).toHaveBeenCalledOnce()

    await act(async () => {
      getButton(container, '⚙ 设置').click()
    })
    expect(openExtensionPageMock).toHaveBeenCalledWith('settings')
  })

  it('extracts the article and opens the shared reading workspace', async () => {
    const container = await renderPopup()

    await act(async () => {
      getButton(container, '在侧边栏翻译文章').click()
      await flushPromises()
    })

    expect(extractArticleFromActiveTabMock).toHaveBeenCalledOnce()
    expect(persistPendingTranslationMock).toHaveBeenCalledWith({
      title: 'Extracted Article',
      author: 'Author',
      sourceUrl: 'https://docs.example.com/current',
      originalMarkdown: '# Full original Markdown',
      createdAt: expect.any(Number),
    })
    expect(openReadingWorkspaceMock).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('翻译将在网页旁的侧边栏中展示')
  })

  it('disables extraction and explains unsupported pages', async () => {
    queryTabsMock.mockResolvedValue([
      { id: 1, title: 'Extensions', url: 'chrome://extensions' },
    ] as chrome.tabs.Tab[])
    const container = await renderPopup()
    const primaryButton = getButton(container, '在侧边栏翻译文章')

    expect(primaryButton.disabled).toBe(true)
    expect(container.textContent).toContain('当前页面不可访问')
    expect(container.textContent).toContain('当前页面不支持正文提取')
  })

  it('gives an actionable cleanup step when pending content cannot be stored', async () => {
    persistPendingTranslationMock.mockRejectedValueOnce(
      new Error(STORAGE_CAPACITY_ERROR_MESSAGE),
    )
    const container = await renderPopup()

    await act(async () => {
      getButton(container, '在侧边栏翻译文章').click()
      await flushPromises()
    })

    expect(container.textContent).toContain('本地存储空间不足')
    expect(container.textContent).toContain('删除较早历史')
    expect(openReadingWorkspaceMock).not.toHaveBeenCalled()
  })
})

async function renderPopup(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<App />)
    await flushPromises()
  })

  return container
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
  }
}

function findButton(container: HTMLDivElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === label,
  )
}

function getButton(container: HTMLDivElement, label: string): HTMLButtonElement {
  const button = findButton(container, label)

  if (!button) {
    throw new Error(`未找到按钮：${label}`)
  }

  return button
}
