import { describe, expect, it } from 'vitest'
import {
  getArticleSizePreflight,
  LONG_ARTICLE_CHARACTER_THRESHOLD,
} from './articleSizePreflight'

describe('getArticleSizePreflight', () => {
  it('returns zero size for an empty article', () => {
    expect(getArticleSizePreflight('')).toEqual({
      characterCount: 0,
      markdownBlockCount: 0,
      isLongArticle: false,
    })
  })

  it('counts Unicode characters and representative Markdown blocks', () => {
    const markdown = [
      '# Title 😀',
      '',
      'A paragraph',
      'on two lines.',
      '',
      '- first',
      '- second',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| size | 1 |',
      '',
      '```ts',
      'const value = 1',
      '',
      'console.log(value)',
      '```',
    ].join('\n')

    expect(getArticleSizePreflight(markdown)).toEqual({
      characterCount: Array.from(markdown).length,
      markdownBlockCount: 5,
      isLongArticle: false,
    })
  })

  it('recognizes adjacent Markdown block boundaries without blank lines', () => {
    const markdown = '# First\n## Second\nParagraph\n- item\n---\nFinal paragraph'

    expect(getArticleSizePreflight(markdown).markdownBlockCount).toBe(6)
  })

  it('keeps a Setext heading and fenced content with blank lines in one block each', () => {
    const markdown = 'Heading\n=======\n\n```md\nfirst\n```not closed\n\nsecond\n```'

    expect(getArticleSizePreflight(markdown).markdownBlockCount).toBe(2)
  })

  it('marks only articles above the character threshold as long', () => {
    expect(
      getArticleSizePreflight('a'.repeat(LONG_ARTICLE_CHARACTER_THRESHOLD))
        .isLongArticle,
    ).toBe(false)
    expect(
      getArticleSizePreflight('a'.repeat(LONG_ARTICLE_CHARACTER_THRESHOLD + 1))
        .isLongArticle,
    ).toBe(true)
  })
})
