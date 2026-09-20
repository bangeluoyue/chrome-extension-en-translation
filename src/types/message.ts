import type {
  PendingTranslation,
  TranslationProgress,
  TranslationResult,
  UserConfig,
} from './storage'

// 模块间消息协议（通过 chrome.runtime.sendMessage / onMessage 通信）
export type ExtensionMessage =
  | { type: 'get-config' }
  | { type: 'save-config'; config: UserConfig }
  | { type: 'clear-api-key' }
  | { type: 'get-last-result' }
  | { type: 'save-completed-translation'; result: TranslationResult }
  | { type: 'clear-last-result' }
  | { type: 'get-pending-translation' }
  | { type: 'save-pending-translation'; pending: PendingTranslation }
  | { type: 'clear-pending-translation' }
  | { type: 'get-translation-progress' }
  | { type: 'save-translation-progress'; progress: TranslationProgress }
  | { type: 'clear-translation-progress' }
  | { type: 'get-pending-selection' }
  | { type: 'clear-pending-selection' }
  | { type: 'get-translation-history' }
  | { type: 'delete-translation-history'; id: string }

// 消息响应统一结构
export type ExtensionResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string }
