import type { PendingTranslation, TranslationResult, UserConfig } from './storage'

// 模块间消息协议（通过 chrome.runtime.sendMessage / onMessage 通信）
export type ExtensionMessage =
  | { type: 'get-config' }
  | { type: 'save-config'; config: UserConfig }
  | { type: 'get-last-result' }
  | { type: 'save-last-result'; result: TranslationResult }
  | { type: 'clear-last-result' }
  | { type: 'get-pending-translation' }
  | { type: 'save-pending-translation'; pending: PendingTranslation }
  | { type: 'clear-pending-translation' }

// 消息响应统一结构
export type ExtensionResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string }
