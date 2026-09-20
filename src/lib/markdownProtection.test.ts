import { describe, expect, it } from 'vitest'
import {
  assertCompleteMarkdownFences,
  protectMarkdownStructure,
  restoreProtectedMarkdown,
} from './markdownProtection'

describe('Markdown structure protection', () => {
  it('restores fenced code, inline code, image URLs, and link targets byte-for-byte', () => {
    const markdown = [
      '# Guide',
      '',
      '```ts\r',
      'const endpoint = `https://api.example.com/v1`\r',
      '```',
      '',
      'Run `npm run build` and keep ``const marker = `x` `` unchanged.',
      '',
      'Read [documentation](https://example.com/a_(b)?q=1#part "Docs").',
      'See ![Architecture](<https://cdn.example.com/diagram (1).png> "Diagram").',
    ].join('\n')
    const protection = protectMarkdownStructure(markdown)

    expect(protection.tokens.map(({ kind, value }) => ({ kind, value }))).toEqual([
      {
        kind: 'fenced-code',
        value: '```ts\r\nconst endpoint = `https://api.example.com/v1`\r\n```',
      },
      { kind: 'inline-code', value: '`npm run build`' },
      { kind: 'inline-code', value: '``const marker = `x` ``' },
      {
        kind: 'link-destination',
        value: 'https://example.com/a_(b)?q=1#part',
      },
      {
        kind: 'image-destination',
        value: '<https://cdn.example.com/diagram (1).png>',
      },
    ])
    expect(protection.protectedMarkdown).not.toContain('npm run build')
    expect(protection.protectedMarkdown).not.toContain('https://example.com/a_(b)')

    const modelOutput = protection.protectedMarkdown
      .replace('# Guide', '# 指南')
      .replace('Run ', '运行 ')
      .replace(' and keep ', '，并保持 ')
      .replace(' unchanged.', ' 不变。')
      .replace('Read [documentation]', '阅读[文档]')
      .replace('See ![Architecture]', '查看![架构图]')
    const restored = restoreProtectedMarkdown(modelOutput, protection)

    for (const token of protection.tokens) {
      expect(restored).toContain(token.value)
    }
    expect(restored).toContain('# 指南')
    expect(restored).toContain('阅读[文档](https://example.com/a_(b)?q=1#part "Docs")')
    expect(restored).toContain(
      '查看![架构图](<https://cdn.example.com/diagram (1).png> "Diagram")',
    )
  })

  it('chooses a marker namespace that does not collide with source text', () => {
    const protection = protectMarkdownStructure('Text ⟦MDP0_0000⟧ with `code`')

    expect(protection.markerPrefix).toBe('⟦MDP1_')
    expect(restoreProtectedMarkdown(protection.protectedMarkdown, protection)).toBe(
      'Text ⟦MDP0_0000⟧ with `code`',
    )
  })

  it('rejects missing, duplicated, reordered, and incomplete protection markers', () => {
    const protection = protectMarkdownStructure('Use `first` and `second`.')
    const [first, second] = protection.tokens

    expect(() =>
      restoreProtectedMarkdown(
        protection.protectedMarkdown.replace(first.marker, ''),
        protection,
      ),
    ).toThrow('保护标记数量不一致')
    expect(() =>
      restoreProtectedMarkdown(
        `${protection.protectedMarkdown} ${first.marker}`,
        protection,
      ),
    ).toThrow('保护标记数量不一致')
    expect(() =>
      restoreProtectedMarkdown(`${second.marker} ${first.marker}`, protection),
    ).toThrow('保护标记顺序或内容发生变化')
    expect(() =>
      restoreProtectedMarkdown(
        protection.protectedMarkdown.replace(first.marker, first.marker.slice(0, -1)),
        protection,
      ),
    ).toThrow('Markdown 结构校验失败')
  })

  it('rejects incomplete source or translated Markdown fences', () => {
    expect(() => protectMarkdownStructure('```ts\nconst value = 1')).toThrow(
      '代码围栏不完整',
    )

    const protection = protectMarkdownStructure('Translate this paragraph.')

    expect(() =>
      restoreProtectedMarkdown('翻译这个段落。\n\n```ts\nconst value = 1', protection),
    ).toThrow('代码围栏不完整')
    expect(() => assertCompleteMarkdownFences('~~~ts\nconst value = 1\n~~~~')).not.toThrow()
  })
})
