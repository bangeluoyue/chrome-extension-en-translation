import { describe, expect, it } from 'vitest'
import { extractArticle } from './articleExtractor'

function createArticleDocument(title: string, content: string): Document {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const articleDocument = frame.contentDocument

  if (!articleDocument) {
    throw new Error('无法创建文章测试文档')
  }

  articleDocument.title = title
  articleDocument.body.innerHTML = content

  return articleDocument
}

describe('articleExtractor', () => {
  it('keeps a long title, code, tables, and lazy-loaded images', () => {
    const longTitle =
      'A Practical Guide to Rendering Extremely Detailed Technical Articles Without Losing Their Important Structure'
    const articleDocument = createArticleDocument(
      longTitle,
      `<article>
        <h1>${longTitle}</h1>
        <p>${'This paragraph provides enough technical context for reliable article extraction. '.repeat(12)}</p>
        <pre><code>const answer = 42
console.log(answer)</code></pre>
        <table>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody><tr><td>answer</td><td>42</td></tr></tbody>
        </table>
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
          data-src="https://cdn.example.com/architecture.png" alt="Architecture diagram">
      </article>`,
    )

    const result = extractArticle(articleDocument)

    expect(result.title).toBe(longTitle)
    expect(result.markdown).toContain('```')
    expect(result.markdown).toContain('const answer = 42')
    expect(result.markdown).toMatch(/\|\s*Name\s*\|\s*Value\s*\|/)
    expect(result.markdown).toContain(
      '![Architecture diagram](https://cdn.example.com/architecture.png)',
    )
  })

  it('reports an extraction error when the page has no article content', () => {
    const articleDocument = createArticleDocument(
      'Navigation only',
      '<nav>Site navigation</nav><footer>Copyright notice</footer>',
    )

    expect(() => extractArticle(articleDocument)).toThrow(/正文内容/)
  })

  it('extracts a very long article without truncating its final paragraph', () => {
    const paragraphs = Array.from(
      { length: 500 },
      (_, index) =>
        `<p>Paragraph ${index + 1}: ${'Detailed technical explanation for the reader. '.repeat(4)}</p>`,
    ).join('')
    const articleDocument = createArticleDocument(
      'Long-form engineering article',
      `<article><h1>Long-form engineering article</h1>${paragraphs}</article>`,
    )

    const result = extractArticle(articleDocument)

    expect(result.markdown).toContain('Paragraph 1:')
    expect(result.markdown).toContain('Paragraph 500:')
    expect(result.markdown.length).toBeGreaterThan(80_000)
  })
})
