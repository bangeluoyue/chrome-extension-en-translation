import type {
  ExtensionMessage,
  ExtensionResponse,
  CompletedTranslationSaveResult,
  PendingSelection,
  PendingTranslation,
  TranslationHistoryEntry,
  TranslationProgress,
  TranslationResult,
  UserConfig,
} from '../types'

export function loadUserConfig(): Promise<UserConfig> {
  return sendStorageMessage<UserConfig>({ type: 'get-config' })
}

export function persistUserConfig(config: UserConfig): Promise<void> {
  return sendStorageMessage<void>({ type: 'save-config', config })
}

export function removeUserApiKey(): Promise<void> {
  return sendStorageMessage<void>({ type: 'clear-api-key' })
}

export function loadLastResult(): Promise<TranslationResult | null> {
  return sendStorageMessage<TranslationResult | null>({ type: 'get-last-result' })
}

export function persistCompletedTranslation(
  result: TranslationResult,
): Promise<CompletedTranslationSaveResult> {
  return sendStorageMessage<CompletedTranslationSaveResult>({
    type: 'save-completed-translation',
    result,
  })
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

export function loadTranslationProgress(): Promise<TranslationProgress | null> {
  return sendStorageMessage<TranslationProgress | null>({
    type: 'get-translation-progress',
  })
}

export function persistTranslationProgress(
  progress: TranslationProgress,
): Promise<void> {
  return sendStorageMessage<void>({ type: 'save-translation-progress', progress })
}

export function removeTranslationProgress(): Promise<void> {
  return sendStorageMessage<void>({ type: 'clear-translation-progress' })
}

export function loadPendingSelection(): Promise<PendingSelection | null> {
  return sendStorageMessage<PendingSelection | null>({ type: 'get-pending-selection' })
}

export function removePendingSelection(): Promise<void> {
  return sendStorageMessage<void>({ type: 'clear-pending-selection' })
}

export function loadTranslationHistory(): Promise<TranslationHistoryEntry[]> {
  return sendStorageMessage<TranslationHistoryEntry[]>({ type: 'get-translation-history' })
}

export function removeTranslationHistoryEntry(
  id: string,
): Promise<TranslationHistoryEntry[]> {
  return sendStorageMessage<TranslationHistoryEntry[]>({
    type: 'delete-translation-history',
    id,
  })
}

async function sendStorageMessage<T>(message: ExtensionMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse<T>>(message)

  if (!response || !response.ok) {
    throw new Error(response?.error || '本地存储服务无响应')
  }

  return response.data
}
