import type { TranslationResult } from '../types'

type ArticleMetadata = Pick<TranslationResult, 'title' | 'author' | 'sourceUrl'>

export function formatTranslationMarkdown(
  article: ArticleMetadata,
  translatedMarkdown: string,
): string {
  const title = normalizeInlineText(article.title) || '未命名文章'
  const author = normalizeInlineText(article.author) || '未知'
  const sourceUrl = article.sourceUrl.trim()
  const body = translatedMarkdown.trim()

  return `# ${title}\n\n> **作者**：${author}\n> **原文链接**：${sourceUrl}\n\n${body}`
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
