import type { TranslationResult } from '../types'

export type TranslationMarkdownVariant = 'translation' | 'bilingual'

type TranslationArticle = Pick<
  TranslationResult,
  'title' | 'author' | 'sourceUrl' | 'originalMarkdown'
>

export function formatTranslationMarkdown(
  article: TranslationArticle,
  translatedMarkdown: string,
  variant: TranslationMarkdownVariant,
): string {
  const title = normalizeInlineText(article.title) || '未命名文章'
  const author = normalizeInlineText(article.author) || '未知'
  const sourceUrl = article.sourceUrl.trim() || '暂无'
  const metadata = `# ${title}\n\n> **作者**：${author}\n> **原文链接**：${sourceUrl}`
  const translation = translatedMarkdown.trim()

  if (variant === 'translation') {
    return `${metadata}\n\n${translation}`
  }

  return `${metadata}\n\n## 原文\n\n${article.originalMarkdown.trim()}\n\n## 译文\n\n${translation}`
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
