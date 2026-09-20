import { countUnicodeCharacters, getMarkdownBlocks } from './markdownBlocks'

export const LONG_ARTICLE_CHARACTER_THRESHOLD = 30_000

export interface ArticleSizePreflight {
  characterCount: number
  markdownBlockCount: number
  isLongArticle: boolean
}

export function getArticleSizePreflight(markdown: string): ArticleSizePreflight {
  const characterCount = countUnicodeCharacters(markdown)
  const markdownBlockCount = getMarkdownBlocks(markdown).length

  return {
    characterCount,
    markdownBlockCount,
    isLongArticle: characterCount > LONG_ARTICLE_CHARACTER_THRESHOLD,
  }
}
