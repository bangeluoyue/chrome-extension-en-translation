import { describe, expect, it, vi } from 'vitest'
import { extractArticleFromActiveTab } from './extraction'

describe('active-tab article extraction', () => {
  it('injects the extractor before requesting article content', async () => {
    const article = {
      title: 'Example',
      author: 'Author',
      url: 'https://example.com/article',
      markdown: '# Example',
    }
    const queryTabsMock = vi.mocked(
      chrome.tabs.query as unknown as (queryInfo: object) => Promise<chrome.tabs.Tab[]>,
    )
    const sendMessageMock = vi.mocked(
      chrome.tabs.sendMessage as unknown as (
        tabId: number,
        message: unknown,
      ) => Promise<unknown>,
    )
    queryTabsMock.mockResolvedValueOnce([{ id: 42 } as chrome.tabs.Tab])
    sendMessageMock.mockResolvedValueOnce({ ok: true, data: article })

    await expect(extractArticleFromActiveTab()).resolves.toEqual(article)
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['content.js'],
    })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: 'EXTRACT_ARTICLE',
    })
    expect(
      vi.mocked(chrome.scripting.executeScript).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(chrome.tabs.sendMessage).mock.invocationCallOrder[0])
  })

  it('does not message the page when script injection is blocked', async () => {
    const queryTabsMock = vi.mocked(
      chrome.tabs.query as unknown as (queryInfo: object) => Promise<chrome.tabs.Tab[]>,
    )
    queryTabsMock.mockResolvedValueOnce([{ id: 42 } as chrome.tabs.Tab])
    vi.mocked(chrome.scripting.executeScript).mockRejectedValueOnce(new Error('blocked'))

    await expect(extractArticleFromActiveTab()).rejects.toThrow('无法访问当前页面')
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })
})
