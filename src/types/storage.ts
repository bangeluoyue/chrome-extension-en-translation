// 存储相关的数据结构定义

// 用户配置（API Key / 模型 / Base URL）
export interface UserConfig {
  apiKey: string
  model: string
  baseUrl: string
}

// Popup 与结果页之间传递的待翻译文章。它与最近一次成功结果分开保存，
// 避免翻译失败时覆盖用户仍可下载的上一次结果。
export interface PendingTranslation {
  title: string
  author: string
  sourceUrl: string
  originalMarkdown: string
  createdAt: number
}

// 从网页右键菜单发送到 Side Panel 的临时划词内容。
export interface PendingSelection {
  sourceText: string
  pageTitle: string
  sourceUrl: string
}

// 长文章翻译的临时检查点。只保存已完成段译文，正文仍从 pendingTranslation 读取。
export interface TranslationProgress {
  sourceUrl: string
  articleCreatedAt: number
  segmentCount: number
  completedSegments: string[]
  updatedAt: number
}

// 最近一次翻译结果
export interface TranslationResult {
  title: string
  author: string
  sourceUrl: string
  originalMarkdown: string
  translatedMarkdown: string
  createdAt: number
}

export interface TranslationHistoryEntry extends TranslationResult {
  id: string
}

export interface CompletedTranslationSaveResult {
  removedHistoryCount: number
}

export const STORAGE_CAPACITY_ERROR_MESSAGE =
  '本地存储空间不足；请删除较早历史或清理扩展本地数据后重试'
