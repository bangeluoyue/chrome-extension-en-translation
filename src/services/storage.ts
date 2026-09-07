import type { PendingTranslation, TranslationResult, UserConfig } from '../types'

// 存储键名
const STORAGE_KEYS = {
  userConfig: 'userConfig',
  lastResult: 'lastResult',
  pendingTranslation: 'pendingTranslation',
} as const

// 默认用户配置
export const DEFAULT_CONFIG: UserConfig = {
  apiKey: '',
  model: 'qwen-plus',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

// 读取用户配置，未保存时返回默认配置
export async function getUserConfig(): Promise<UserConfig> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.userConfig)
  const saved = data[STORAGE_KEYS.userConfig] as UserConfig | undefined
  return saved ? { ...DEFAULT_CONFIG, ...saved } : { ...DEFAULT_CONFIG }
}

// 保存用户配置（覆盖写入）
export async function saveUserConfig(config: UserConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.userConfig]: config })
}

// 读取最近一次翻译结果，无记录时返回 null
export async function getLastResult(): Promise<TranslationResult | null> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.lastResult)
  return (data[STORAGE_KEYS.lastResult] as TranslationResult | undefined) ?? null
}

// 保存最近一次翻译结果（覆盖写入）
export async function saveLastResult(result: TranslationResult): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastResult]: result })
}

// 清除最近一次翻译结果
export async function clearLastResult(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.lastResult)
}

export async function getPendingTranslation(): Promise<PendingTranslation | null> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.pendingTranslation)
  return (data[STORAGE_KEYS.pendingTranslation] as PendingTranslation | undefined) ?? null
}

export async function savePendingTranslation(pending: PendingTranslation): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingTranslation]: pending })
}

export async function clearPendingTranslation(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.pendingTranslation)
}
