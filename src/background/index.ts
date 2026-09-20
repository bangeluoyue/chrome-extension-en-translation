import type { ExtensionMessage } from '../types'
import {
  clearUserApiKey,
  clearTranslationProgress,
  clearPendingSelection,
  clearPendingTranslation,
  clearLastResult,
  deleteTranslationFromHistory,
  getLastResult,
  getPendingSelection,
  getPendingTranslation,
  getTranslationHistory,
  getTranslationProgress,
  getUserConfig,
  saveCompletedTranslation,
  savePendingSelection,
  savePendingTranslation,
  saveTranslationProgress,
  saveUserConfig,
} from '../services/storage'

export const SELECTION_MENU_ID = 'translate-selected-text'

chrome.runtime.onInstalled.addListener(() => {
  registerSelectionContextMenu()
  console.log('[网页翻译] 扩展已安装')
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleSelectionMenuClick(info, tab).catch((error: unknown) => {
    console.error('[网页翻译] 无法打开划词翻译', error)
  })
})

// 存储服务消息路由：供 Popup / 结果页 / 设置页调用
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }))

    // 异步处理，保持消息通道开启，等待响应返回
    return true
  },
)

export function registerSelectionContextMenu(): void {
  chrome.contextMenus.create({
    id: SELECTION_MENU_ID,
    title: '翻译所选文字',
    contexts: ['selection'],
  })
}

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'get-config':
      return getUserConfig()
    case 'save-config':
      return saveUserConfig(message.config)
    case 'clear-api-key':
      return clearUserApiKey()
    case 'get-last-result':
      return getLastResult()
    case 'save-completed-translation':
      return saveCompletedTranslation(message.result)
    case 'clear-last-result':
      return clearLastResult()
    case 'get-pending-translation':
      return getPendingTranslation()
    case 'save-pending-translation':
      return savePendingTranslation(message.pending)
    case 'clear-pending-translation':
      return clearPendingTranslation()
    case 'get-translation-progress':
      return getTranslationProgress()
    case 'save-translation-progress':
      return saveTranslationProgress(message.progress)
    case 'clear-translation-progress':
      return clearTranslationProgress()
    case 'get-pending-selection':
      return getPendingSelection()
    case 'clear-pending-selection':
      return clearPendingSelection()
    case 'get-translation-history':
      return getTranslationHistory()
    case 'delete-translation-history':
      return deleteTranslationFromHistory(message.id)
    default:
      throw new Error(`未知消息类型: ${(message as ExtensionMessage).type}`)
  }
}

export async function handleSelectionMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  if (
    info.menuItemId !== SELECTION_MENU_ID ||
    !info.selectionText?.trim() ||
    tab?.id === undefined
  ) {
    return
  }

  const selection = {
    sourceText: info.selectionText,
    pageTitle: tab.title ?? '',
    sourceUrl: info.pageUrl || tab.url || '',
  }

  // 两个 API 调用都在用户手势处理期间发起，确保 Side Panel 可以打开。
  await Promise.all([
    savePendingSelection(selection),
    chrome.sidePanel.open({ tabId: tab.id }),
  ])
}
