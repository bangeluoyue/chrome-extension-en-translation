import { describe, expect, it } from 'vitest'
import type { TranslationResult } from '../types'
import { formatTranslationMarkdown } from './translationMarkdown'

const article: TranslationResult = {
  title: 'Example Article',
  author: 'Ada Lovelace',
  sourceUrl: 'https://example.com/article',
  originalMarkdown: '# Original\n\nEnglish body.',
  translatedMarkdown: '# 译文\n\n中文正文。',
  createdAt: 1,
}

describe('translation Markdown formatting', () => {
  it('formats translation-only Markdown with article metadata', () => {
    expect(
      formatTranslationMarkdown(article, article.translatedMarkdown, 'translation'),
    ).toBe(
      '# Example Article\n\n> **作者**：Ada Lovelace\n> **原文链接**：https://example.com/article\n\n# 译文\n\n中文正文。',
    )
  })

  it('formats bilingual Markdown with complete original and translated sections', () => {
    expect(
      formatTranslationMarkdown(article, article.translatedMarkdown, 'bilingual'),
    ).toBe(
      '# Example Article\n\n> **作者**：Ada Lovelace\n> **原文链接**：https://example.com/article\n\n## 原文\n\n# Original\n\nEnglish body.\n\n## 译文\n\n# 译文\n\n中文正文。',
    )
  })
})
