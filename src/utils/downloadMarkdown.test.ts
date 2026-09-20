import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownFilename, downloadMarkdown } from './downloadMarkdown'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Markdown download filename', () => {
  it('uses the article title and replaces filename characters rejected by browsers', () => {
    expect(createMarkdownFilename('Report: A/B?*')).toBe('Report- A-B--.md')
  })

  it('falls back for an empty sanitized title', () => {
    expect(createMarkdownFilename('  ...  ')).toBe('翻译结果.md')
  })

  it('limits long filenames', () => {
    expect(createMarkdownFilename('a'.repeat(100))).toBe(`${'a'.repeat(80)}.md`)
    expect(createMarkdownFilename(`${'a'.repeat(79)}.after-limit`)).toBe(
      `${'a'.repeat(79)}.md`,
    )
  })

  it('creates a Markdown blob and triggers a browser download', () => {
    const createObjectUrlMock = vi.fn((_blob: unknown) => 'blob:test-markdown')
    const revokeObjectUrlMock = vi.fn()
    let blobParts: BlobPart[] = []
    let blobType = ''
    let clickedFilename = ''
    vi.useFakeTimers()
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          blobParts = parts
          blobType = options?.type ?? ''
        }
      },
    )
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrlMock,
      revokeObjectURL: revokeObjectUrlMock,
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedFilename = this.download
    })

    const markdown = '# Article\n\n完整双语正文'
    downloadMarkdown(markdown, 'Article: One')

    expect(blobType).toBe('text/markdown;charset=utf-8')
    expect(blobParts).toEqual([markdown])
    expect(createObjectUrlMock).toHaveBeenCalledOnce()
    expect(clickedFilename).toBe('Article- One.md')

    vi.advanceTimersByTime(1000)
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:test-markdown')
  })
})
