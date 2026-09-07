import type { ExtractArticleRequest, ExtractArticleResponse, ExtractedArticle } from '../types/extraction'

// 与 Content Script 仅共享类型，避免 Rollup 生成浏览器无法加载的 Content Script 共享模块。
const EXTRACT_ARTICLE_MESSAGE: ExtractArticleRequest['type'] = 'EXTRACT_ARTICLE'

export async function extractArticleFromActiveTab(): Promise<ExtractedArticle> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (activeTab?.id === undefined) {
    throw new Error('未找到当前标签页')
  }

  const request: ExtractArticleRequest = { type: EXTRACT_ARTICLE_MESSAGE }
  const response: unknown = await chrome.tabs.sendMessage<ExtractArticleRequest, ExtractArticleResponse>(
    activeTab.id,
    request,
  )

  if (!isExtractArticleResponse(response)) {
    throw new Error('正文提取返回了无效结果')
  }

  if (!response.ok) {
    throw new Error(response.error)
  }

  return response.data
}

function isExtractArticleResponse(response: unknown): response is ExtractArticleResponse {
  if (typeof response !== 'object' || response === null) {
    return false
  }

  const value = response as Record<string, unknown>

  if (value.ok === false) {
    return typeof value.error === 'string'
  }

  if (value.ok !== true || typeof value.data !== 'object' || value.data === null) {
    return false
  }

  const data = value.data as Record<string, unknown>

  return (
    typeof data.title === 'string' &&
    typeof data.author === 'string' &&
    typeof data.url === 'string' &&
    typeof data.markdown === 'string'
  )
}
