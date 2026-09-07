import type { ExtensionMessage } from '../types'
import {
  clearPendingTranslation,
  clearLastResult,
  getLastResult,
  getPendingTranslation,
  getUserConfig,
  saveLastResult,
  savePendingTranslation,
  saveUserConfig,
} from '../services/storage'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[网页翻译] 扩展已安装')
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

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'get-config':
      return getUserConfig()
    case 'save-config':
      return saveUserConfig(message.config)
    case 'get-last-result':
      return getLastResult()
    case 'save-last-result':
      return saveLastResult(message.result)
    case 'clear-last-result':
      return clearLastResult()
    case 'get-pending-translation':
      return getPendingTranslation()
    case 'save-pending-translation':
      return savePendingTranslation(message.pending)
    case 'clear-pending-translation':
      return clearPendingTranslation()
    default:
      throw new Error(`未知消息类型: ${(message as ExtensionMessage).type}`)
  }
}
