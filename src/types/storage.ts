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

// 最近一次翻译结果
export interface TranslationResult {
  title: string
  author: string
  sourceUrl: string
  originalMarkdown: string
  translatedMarkdown: string
  createdAt: number
}
