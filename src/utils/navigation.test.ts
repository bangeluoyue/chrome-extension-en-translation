import { describe, expect, it, vi } from 'vitest'
import { openReadingWorkspace } from './navigation'

describe('openReadingWorkspace', () => {
  it('opens the side panel for the active tab', async () => {
    const queryTabs = vi.mocked(
      chrome.tabs.query as (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>,
    )
    queryTabs.mockResolvedValueOnce([{ id: 42 }] as chrome.tabs.Tab[])

    await expect(openReadingWorkspace()).resolves.toBe('sidepanel')
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 })
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('falls back to the result page when the side panel cannot open', async () => {
    const queryTabs = vi.mocked(
      chrome.tabs.query as (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>,
    )
    queryTabs.mockResolvedValueOnce([{ id: 42 }] as chrome.tabs.Tab[])
    vi.mocked(chrome.sidePanel.open).mockRejectedValueOnce(new Error('side panel unavailable'))

    await expect(openReadingWorkspace()).resolves.toBe('result')
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/result.html',
    })
  })
})
