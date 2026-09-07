import type {
  ExtensionMessage,
  ExtensionResponse,
  PendingTranslation,
  TranslationResult,
  UserConfig,
} from '../types'

export function loadUserConfig(): Promise<UserConfig> {
  return sendStorageMessage<UserConfig>({ type: 'get-config' })
}

export function persistUserConfig(config: UserConfig): Promise<void> {
  return sendStorageMessage<void>({ type: 'save-config', config })
}

export function loadLastResult(): Promise<TranslationResult | null> {
  return sendStorageMessage<TranslationResult | null>({ type: 'get-last-result' })
}

export function persistLastResult(result: TranslationResult): Promise<void> {
  return sendStorageMessage<void>({ type: 'save-last-result', result })
}

export function loadPendingTranslation(): Promise<PendingTranslation | null> {
  return sendStorageMessage<PendingTranslation | null>({ type: 'get-pending-translation' })
}

export function persistPendingTranslation(pending: PendingTranslation): Promise<void> {
  return sendStorageMessage<void>({ type: 'save-pending-translation', pending })
}

export function removePendingTranslation(): Promise<void> {
  return sendStorageMessage<void>({ type: 'clear-pending-translation' })
}

async function sendStorageMessage<T>(message: ExtensionMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse<T>>(message)

  if (!response || !response.ok) {
    throw new Error(response?.error || '本地存储服务无响应')
  }

  return response.data
}
