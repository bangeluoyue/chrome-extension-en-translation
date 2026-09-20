import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handleSelectionMenuClick,
  registerSelectionContextMenu,
  SELECTION_MENU_ID,
} from './index'

beforeEach(async () => {
  await chrome.storage.local.clear()
})

describe('selection context menu', () => {
  it('registers a menu that is only shown for selected text', () => {
    registerSelectionContextMenu()

    expect(vi.mocked(chrome.contextMenus.create)).toHaveBeenCalledWith({
      id: SELECTION_MENU_ID,
      title: '翻译所选文字',
      contexts: ['selection'],
    })
  })

  it('stores the exact selection and opens the Side Panel for its tab', async () => {
    const sourceText = '  The browser parses HTML.\nNext line.  '

    await handleSelectionMenuClick(
      {
        menuItemId: SELECTION_MENU_ID,
        selectionText: sourceText,
        pageUrl: 'https://example.com/article',
      } as chrome.contextMenus.OnClickData,
      {
        id: 27,
        title: 'Example Article',
        url: 'https://example.com/article',
      } as chrome.tabs.Tab,
    )

    await expect(chrome.storage.local.get('pendingSelection')).resolves.toEqual({
      pendingSelection: {
        sourceText,
        pageTitle: 'Example Article',
        sourceUrl: 'https://example.com/article',
      },
    })
    expect(vi.mocked(chrome.sidePanel.open)).toHaveBeenCalledWith({ tabId: 27 })
  })

  it('ignores clicks from other context menu items', async () => {
    await handleSelectionMenuClick(
      {
        menuItemId: 'another-menu',
        selectionText: 'Text',
      } as chrome.contextMenus.OnClickData,
      { id: 27 } as chrome.tabs.Tab,
    )

    await expect(chrome.storage.local.get('pendingSelection')).resolves.toEqual({})
    expect(vi.mocked(chrome.sidePanel.open)).not.toHaveBeenCalled()
  })
})
