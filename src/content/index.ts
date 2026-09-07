import { extractArticle } from '../lib/articleExtractor'
import type { ExtractArticleRequest, ExtractArticleResponse } from '../types/extraction'

// Content Script 必须保持为无 import 的单文件；运行时常量留在入口，类型契约仍集中共享。
const EXTRACT_ARTICLE_MESSAGE: ExtractArticleRequest['type'] = 'EXTRACT_ARTICLE'

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isExtractArticleRequest(message)) {
    return
  }

  let response: ExtractArticleResponse

  try {
    response = {
      ok: true,
      data: extractArticle(document),
    }
  } catch (error) {
    response = {
      ok: false,
      error: error instanceof Error ? error.message : '正文提取失败',
    }
  }

  sendResponse(response)
})

function isExtractArticleRequest(message: unknown): message is ExtractArticleRequest {
  if (typeof message !== 'object' || message === null) {
    return false
  }

  return (message as Record<string, unknown>).type === EXTRACT_ARTICLE_MESSAGE
}
