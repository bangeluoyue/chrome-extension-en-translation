import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { ExtractedArticle } from '../types/extraction'

const LAZY_IMAGE_ATTRIBUTES = [
  'data-original',
  'data-original-src',
  'data-src',
  'data-lazy-src',
  'data-hi-res-src',
  'data-url',
] as const

const FALLBACK_CONTENT_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.post-content',
  '.article-content',
  '.entry-content',
  '#article-body',
  '#content',
] as const

const FALLBACK_NOISE_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'nav',
  'aside',
  'footer',
  'form',
  'dialog',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  '.advertisement',
  '.advert',
  '.ads',
  '.sidebar',
  '.comments',
  '.related',
].join(',')

interface ReadabilityArticle {
  title?: string | null
  byline?: string | null
  content?: string | null
}

interface SrcsetCandidate {
  url: string
  score: number
}

export function extractArticle(sourceDocument: Document): ExtractedArticle {
  const originalUrl = sourceDocument.location.href
  const preparedDocument = prepareDocument(sourceDocument, originalUrl)
  const readabilityDocument = preparedDocument.cloneNode(true) as Document
  const readabilityArticle = new Readability(readabilityDocument).parse()
  const articleHtml = getArticleHtml(readabilityArticle, preparedDocument)

  if (!articleHtml) {
    throw new Error('未能识别当前页面的正文内容')
  }

  const markdown = htmlToMarkdown(articleHtml)

  if (!markdown) {
    throw new Error('正文内容为空，无法转换为 Markdown')
  }

  return {
    title: getTitle(sourceDocument, readabilityArticle),
    author: getAuthor(sourceDocument, readabilityArticle),
    url: originalUrl,
    markdown,
  }
}

function prepareDocument(sourceDocument: Document, baseUrl: string): Document {
  // Readability 会重写并删除节点；始终在副本上提取，避免影响用户正在浏览的页面。
  const clonedDocument = sourceDocument.cloneNode(true) as Document
  const sourceImages = Array.from(sourceDocument.querySelectorAll('img'))
  const clonedImages = Array.from(clonedDocument.querySelectorAll('img'))

  clonedImages.forEach((image, index) => {
    normalizeImage(image, sourceImages[index], baseUrl)
  })

  clonedDocument.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const href = link.getAttribute('href')

    if (href) {
      link.setAttribute('href', toAbsoluteUrl(href, baseUrl))
    }
  })

  return clonedDocument
}

function normalizeImage(
  image: HTMLImageElement,
  sourceImage: HTMLImageElement | undefined,
  baseUrl: string,
): void {
  // 先固化懒加载真实地址，否则 Readability 可能只保留占位图的 src。
  const { lazySourceSets, sourceSets } = collectImageSourceSets(image)
  const lazySrcsetUrl = getBestSrcsetUrl(lazySourceSets)
  const lazyUrl = LAZY_IMAGE_ATTRIBUTES.map((attribute) => image.getAttribute(attribute)).find(
    (value): value is string => Boolean(value?.trim()),
  )
  const imageUrl =
    lazySrcsetUrl ||
    lazyUrl ||
    getBestSrcsetUrl(sourceSets) ||
    sourceImage?.currentSrc ||
    image.getAttribute('src') ||
    ''
  const alt = image.getAttribute('alt') || image.getAttribute('title') || ''

  image.setAttribute('src', imageUrl ? toAbsoluteUrl(imageUrl, baseUrl) : '')
  image.setAttribute('alt', alt.trim())
  image.removeAttribute('srcset')
  image.removeAttribute('data-srcset')
}

function collectImageSourceSets(image: HTMLImageElement): {
  lazySourceSets: string[]
  sourceSets: string[]
} {
  const pictureSources = Array.from(image.closest('picture')?.querySelectorAll('source') ?? [])
  const isSourceSet = (value: string | null): value is string => Boolean(value?.trim())

  return {
    lazySourceSets: [
      image.getAttribute('data-srcset'),
      ...pictureSources.map((source) => source.getAttribute('data-srcset')),
    ].filter(isSourceSet),
    sourceSets: [
      ...pictureSources.map((source) => source.getAttribute('srcset')),
      image.getAttribute('srcset'),
    ].filter(isSourceSet),
  }
}

function getBestSrcsetUrl(sourceSets: string[]): string {
  const candidates = sourceSets.flatMap(parseSrcset)

  if (candidates.length === 0) {
    return ''
  }

  return candidates.reduce((best, candidate) => (candidate.score > best.score ? candidate : best)).url
}

function parseSrcset(sourceSet: string): SrcsetCandidate[] {
  const sourceSetPattern = /(\S+)(?:\s+([\d.]+)([xw]))?(\s*(?:,|$))/g

  return Array.from(sourceSet.matchAll(sourceSetPattern), (match) => {
    const [, url, descriptor = '', descriptorUnit = ''] = match
    const value = Number.parseFloat(descriptor)
    const score = Number.isFinite(value) ? value * (descriptorUnit === 'x' ? 1_000_000 : 1) : 0

    return { url, score }
  })
}

function toAbsoluteUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href
  } catch {
    return url.trim()
  }
}

function getArticleHtml(
  readabilityArticle: ReadabilityArticle | null,
  preparedDocument: Document,
): string {
  const readabilityContent = readabilityArticle?.content?.trim()

  if (readabilityContent) {
    const container = preparedDocument.createElement('div')
    container.innerHTML = readabilityContent
    removeArticleNoise(container)

    return container.innerHTML.trim()
  }

  const candidates = FALLBACK_CONTENT_SELECTORS.flatMap((selector) =>
    Array.from(preparedDocument.querySelectorAll<HTMLElement>(selector)),
  )
  const bestCandidate = candidates.reduce<HTMLElement | null>((best, candidate) => {
    if (!best) {
      return candidate
    }

    return getTextLength(candidate) > getTextLength(best) ? candidate : best
  }, null)

  const fallbackContent = (bestCandidate ?? preparedDocument.body)?.cloneNode(true) as
    | HTMLElement
    | undefined

  if (fallbackContent) {
    removeArticleNoise(fallbackContent)
  }

  return fallbackContent?.innerHTML.trim() ?? ''
}

function removeArticleNoise(element: HTMLElement): void {
  element.querySelectorAll(FALLBACK_NOISE_SELECTOR).forEach((noiseElement) => noiseElement.remove())
}

function getTextLength(element: HTMLElement): number {
  return element.textContent?.trim().length ?? 0
}

function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  })

  turndown.use(gfm)
  turndown.addRule('normalizedImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = (node.getAttribute('alt') ?? '').replace(/[\]\\]/g, '\\$&').replace(/\s+/g, ' ').trim()
      const src = node.getAttribute('src') ?? ''

      return `![${alt}](${src})`
    },
  })

  return turndown.turndown(html).trim()
}

function getTitle(sourceDocument: Document, readabilityArticle: ReadabilityArticle | null): string {
  return (
    firstNonEmpty(
      readabilityArticle?.title,
      getMetaContent(sourceDocument, 'meta[property="og:title"]'),
      getMetaContent(sourceDocument, 'meta[name="twitter:title"]'),
      sourceDocument.querySelector('h1')?.textContent,
      sourceDocument.title,
    ) ?? '未命名文章'
  )
}

function getAuthor(sourceDocument: Document, readabilityArticle: ReadabilityArticle | null): string {
  return (
    firstNonEmpty(
      readabilityArticle?.byline,
      getMetaContent(sourceDocument, 'meta[name="author"]'),
      getMetaContent(sourceDocument, 'meta[property="article:author"]'),
      sourceDocument.querySelector('[rel="author"]')?.textContent,
    ) ?? ''
  )
}

function getMetaContent(sourceDocument: Document, selector: string): string | null {
  return sourceDocument.querySelector<HTMLMetaElement>(selector)?.content ?? null
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalizedValue = value?.replace(/\s+/g, ' ').trim()

    if (normalizedValue) {
      return normalizedValue
    }
  }

  return null
}
