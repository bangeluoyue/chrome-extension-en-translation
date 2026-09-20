import { describe, expect, it } from 'vitest'
import { countUnicodeCharacters, getMarkdownBlocks } from './markdownBlocks'
import { splitMarkdownIntoSegments } from './markdownSegmenter'

describe('splitMarkdownIntoSegments', () => {
  it('keeps an ordinary article byte-for-byte in one segment', () => {
    const markdown = '  # Title\r\n\r\nParagraph 😀  '

    expect(splitMarkdownIntoSegments(markdown, 100)).toEqual([markdown])
  })

  it('packs headings and complete Markdown blocks in source order', () => {
    const markdown = [
      '# First section',
      '',
      'First paragraph with enough text to fill this segment.',
      '',
      '# List section',
      '',
      '- first item',
      '- second item',
      '',
      '# Data section',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| alpha | one |',
      '',
      '# Code section',
      '',
      '```ts',
      'const first = 1',
      '',
      'const second = 2',
      '```',
    ].join('\n')

    const segments = splitMarkdownIntoSegments(markdown, 90)

    expect(getMarkdownBlocks(markdown).map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'heading',
      'table',
      'heading',
      'code',
    ])
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.join('\n\n')).toBe(markdown)
    expect(segments.every((segment) => countUnicodeCharacters(segment) <= 90)).toBe(true)
    expect(segments.some((segment) => segment.includes('- first item\n- second item'))).toBe(true)
    expect(
      segments.some((segment) =>
        segment.includes('| Name | Value |\n| --- | --- |\n| alpha | one |'),
      ),
    ).toBe(true)
    expect(
      segments.some((segment) =>
        segment.includes('```ts\nconst first = 1\n\nconst second = 2\n```'),
      ),
    ).toBe(true)
  })

  it('moves a trailing heading to the segment containing its content', () => {
    const markdown = `${'a'.repeat(35)}\n\n# Next\n\n${'b'.repeat(35)}`

    expect(splitMarkdownIntoSegments(markdown, 45)).toEqual([
      'a'.repeat(35),
      `# Next\n\n${'b'.repeat(35)}`,
    ])
  })

  it('keeps Setext headings and multiline blockquotes as individual blocks', () => {
    const markdown = 'Heading\n=======\n\n> first line\n> second line'

    expect(getMarkdownBlocks(markdown)).toEqual([
      {
        type: 'heading',
        markdown: 'Heading\n=======',
        characterCount: 15,
      },
      {
        type: 'blockquote',
        markdown: '> first line\n> second line',
        characterCount: 26,
      },
    ])
  })

  it('keeps an oversized fenced block intact', () => {
    const codeBlock = `\`\`\`text\n${'a'.repeat(80)}\n\`\`\``

    expect(splitMarkdownIntoSegments(codeBlock, 40)).toEqual([codeBlock])
  })

  it('rejects an invalid character limit', () => {
    expect(() => splitMarkdownIntoSegments('# Article', 0)).toThrow(
      '分段字符上限必须是正整数',
    )
  })
})
