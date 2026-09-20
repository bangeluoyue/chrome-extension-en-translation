export type MarkdownProtectionKind =
  | 'fenced-code'
  | 'inline-code'
  | 'image-destination'
  | 'link-destination'

export interface MarkdownProtectionToken {
  kind: MarkdownProtectionKind
  marker: string
  value: string
}

export interface MarkdownProtection {
  protectedMarkdown: string
  markerPrefix: string
  markerSuffix: string
  tokens: readonly MarkdownProtectionToken[]
}

interface ProtectedRange {
  start: number
  end: number
  kind: MarkdownProtectionKind
}

interface Line {
  start: number
  contentEnd: number
  text: string
}

interface LinkDestination {
  destinationStart: number
  destinationEnd: number
  linkEnd: number
}

const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const MARKER_SUFFIX = '⟧'

export class MarkdownStructureError extends Error {
  constructor(message: string) {
    super(`Markdown 结构校验失败：${message}`)
    this.name = 'MarkdownStructureError'
  }
}

export function protectMarkdownStructure(markdown: string): MarkdownProtection {
  const fencedCodeRanges = findFencedCodeRanges(markdown)
  const inlineCodeRanges = findInlineCodeRanges(markdown, fencedCodeRanges)
  const codeRanges = [...fencedCodeRanges, ...inlineCodeRanges].sort(
    (left, right) => left.start - right.start,
  )
  const linkRanges = findLinkDestinationRanges(markdown, codeRanges)
  const ranges = [...codeRanges, ...linkRanges].sort(
    (left, right) => left.start - right.start,
  )
  const markerPrefix = createMarkerPrefix(markdown)
  const tokens: MarkdownProtectionToken[] = []
  let protectedMarkdown = ''
  let sourceIndex = 0

  ranges.forEach((range, tokenIndex) => {
    const marker = `${markerPrefix}${tokenIndex.toString().padStart(4, '0')}${MARKER_SUFFIX}`
    protectedMarkdown += markdown.slice(sourceIndex, range.start)
    protectedMarkdown += marker
    tokens.push({
      kind: range.kind,
      marker,
      value: markdown.slice(range.start, range.end),
    })
    sourceIndex = range.end
  })

  protectedMarkdown += markdown.slice(sourceIndex)

  return {
    protectedMarkdown,
    markerPrefix,
    markerSuffix: MARKER_SUFFIX,
    tokens,
  }
}

export function restoreProtectedMarkdown(
  translatedMarkdown: string,
  protection: MarkdownProtection,
): string {
  const actualMarkers = collectProtectionMarkers(translatedMarkdown, protection)
  const expectedMarkers = protection.tokens.map((token) => token.marker)

  if (actualMarkers.length !== expectedMarkers.length) {
    throw new MarkdownStructureError('保护标记数量不一致')
  }

  if (actualMarkers.some((marker, index) => marker !== expectedMarkers[index])) {
    throw new MarkdownStructureError('保护标记顺序或内容发生变化')
  }

  let restoredMarkdown = translatedMarkdown

  for (const token of protection.tokens) {
    restoredMarkdown = restoredMarkdown.replace(token.marker, token.value)
  }

  assertCompleteMarkdownFences(restoredMarkdown)
  return restoredMarkdown
}

export function assertCompleteMarkdownFences(markdown: string): void {
  findFencedCodeRanges(markdown)
}

function findFencedCodeRanges(markdown: string): ProtectedRange[] {
  const lines = getLines(markdown)
  const ranges: ProtectedRange[] = []
  let lineIndex = 0

  while (lineIndex < lines.length) {
    const openingMatch = lines[lineIndex].text.match(FENCE_OPEN_PATTERN)

    if (!openingMatch || !isValidFenceOpening(openingMatch[1], openingMatch[2])) {
      lineIndex += 1
      continue
    }

    const openingMarker = openingMatch[1]
    let closingLineIndex = lineIndex + 1

    while (closingLineIndex < lines.length) {
      const closingMatch = lines[closingLineIndex].text.match(FENCE_CLOSE_PATTERN)

      if (
        closingMatch &&
        closingMatch[1][0] === openingMarker[0] &&
        closingMatch[1].length >= openingMarker.length
      ) {
        break
      }

      closingLineIndex += 1
    }

    if (closingLineIndex >= lines.length) {
      throw new MarkdownStructureError('代码围栏不完整')
    }

    ranges.push({
      start: lines[lineIndex].start,
      end: lines[closingLineIndex].contentEnd,
      kind: 'fenced-code',
    })
    lineIndex = closingLineIndex + 1
  }

  return ranges
}

function findInlineCodeRanges(
  markdown: string,
  fencedCodeRanges: readonly ProtectedRange[],
): ProtectedRange[] {
  const ranges: ProtectedRange[] = []
  let sourceIndex = 0
  let fencedRangeIndex = 0

  while (sourceIndex < markdown.length) {
    const fencedRange = fencedCodeRanges[fencedRangeIndex]

    if (fencedRange && sourceIndex >= fencedRange.end) {
      fencedRangeIndex += 1
      continue
    }

    if (fencedRange && sourceIndex >= fencedRange.start) {
      sourceIndex = fencedRange.end
      fencedRangeIndex += 1
      continue
    }

    if (markdown[sourceIndex] !== '`' || isEscaped(markdown, sourceIndex)) {
      sourceIndex += 1
      continue
    }

    const delimiterLength = countRun(markdown, sourceIndex, '`')
    const closingIndex = findInlineCodeClosing(
      markdown,
      sourceIndex + delimiterLength,
      delimiterLength,
      fencedRange,
    )

    if (closingIndex === -1) {
      sourceIndex += delimiterLength
      continue
    }

    const end = closingIndex + delimiterLength
    ranges.push({ start: sourceIndex, end, kind: 'inline-code' })
    sourceIndex = end
  }

  return ranges
}

function findLinkDestinationRanges(
  markdown: string,
  codeRanges: readonly ProtectedRange[],
): ProtectedRange[] {
  const ranges: ProtectedRange[] = []
  let sourceIndex = 0
  let codeRangeIndex = 0

  while (sourceIndex < markdown.length) {
    const codeRange = codeRanges[codeRangeIndex]

    if (codeRange && sourceIndex >= codeRange.end) {
      codeRangeIndex += 1
      continue
    }

    if (codeRange && sourceIndex >= codeRange.start) {
      sourceIndex = codeRange.end
      codeRangeIndex += 1
      continue
    }

    const isImage = markdown[sourceIndex] === '!' && markdown[sourceIndex + 1] === '['
    const labelStart = isImage
      ? sourceIndex + 1
      : markdown[sourceIndex] === '['
        ? sourceIndex
        : -1

    if (labelStart === -1 || isEscaped(markdown, labelStart)) {
      sourceIndex += 1
      continue
    }

    const labelEnd = findClosingBracket(markdown, labelStart, codeRanges)

    if (labelEnd === -1 || markdown[labelEnd + 1] !== '(') {
      sourceIndex = labelStart + 1
      continue
    }

    const destination = findLinkDestination(markdown, labelEnd + 1)

    if (!destination) {
      sourceIndex = labelEnd + 1
      continue
    }

    ranges.push({
      start: destination.destinationStart,
      end: destination.destinationEnd,
      kind: isImage ? 'image-destination' : 'link-destination',
    })
    sourceIndex = destination.linkEnd
  }

  return ranges
}

function findInlineCodeClosing(
  markdown: string,
  startIndex: number,
  delimiterLength: number,
  nextFencedRange?: ProtectedRange,
): number {
  let sourceIndex = startIndex
  const searchEnd = nextFencedRange?.start ?? markdown.length

  while (sourceIndex < searchEnd) {
    const candidateIndex = markdown.indexOf('`', sourceIndex)

    if (candidateIndex === -1 || candidateIndex >= searchEnd) {
      return -1
    }

    const candidateLength = countRun(markdown, candidateIndex, '`')

    if (candidateLength === delimiterLength) {
      return candidateIndex
    }

    sourceIndex = candidateIndex + candidateLength
  }

  return -1
}

function findClosingBracket(
  markdown: string,
  openingIndex: number,
  codeRanges: readonly ProtectedRange[],
): number {
  let depth = 1
  let sourceIndex = openingIndex + 1
  let codeRangeIndex = findRangeIndexAtOrAfter(codeRanges, sourceIndex)

  while (sourceIndex < markdown.length) {
    const codeRange = codeRanges[codeRangeIndex]

    if (codeRange && sourceIndex >= codeRange.end) {
      codeRangeIndex += 1
      continue
    }

    if (codeRange && sourceIndex >= codeRange.start) {
      sourceIndex = codeRange.end
      codeRangeIndex += 1
      continue
    }

    if (isEscaped(markdown, sourceIndex)) {
      sourceIndex += 1
      continue
    }

    if (markdown[sourceIndex] === '[') {
      depth += 1
    } else if (markdown[sourceIndex] === ']') {
      depth -= 1

      if (depth === 0) {
        return sourceIndex
      }
    }

    sourceIndex += 1
  }

  return -1
}

function findLinkDestination(markdown: string, openParenIndex: number): LinkDestination | null {
  let sourceIndex = openParenIndex + 1

  while (isMarkdownWhitespace(markdown[sourceIndex])) {
    sourceIndex += 1
  }

  const destinationStart = sourceIndex

  if (markdown[sourceIndex] === '<') {
    sourceIndex += 1

    while (sourceIndex < markdown.length) {
      if (!isEscaped(markdown, sourceIndex) && markdown[sourceIndex] === '>') {
        const destinationEnd = sourceIndex + 1
        const linkEnd = findLinkClosingAfterDestination(markdown, destinationEnd)
        return linkEnd === -1
          ? null
          : { destinationStart, destinationEnd, linkEnd }
      }

      if (markdown[sourceIndex] === '\n' || markdown[sourceIndex] === '\r') {
        return null
      }

      sourceIndex += 1
    }

    return null
  }

  let nestedParentheses = 0

  while (sourceIndex < markdown.length) {
    if (isEscaped(markdown, sourceIndex)) {
      sourceIndex += Math.min(2, markdown.length - sourceIndex)
      continue
    }

    const character = markdown[sourceIndex]

    if (character === '(') {
      nestedParentheses += 1
      sourceIndex += 1
      continue
    }

    if (character === ')') {
      if (nestedParentheses === 0) {
        return {
          destinationStart,
          destinationEnd: sourceIndex,
          linkEnd: sourceIndex + 1,
        }
      }

      nestedParentheses -= 1
      sourceIndex += 1
      continue
    }

    if (isMarkdownWhitespace(character) && nestedParentheses === 0) {
      const linkEnd = findLinkClosingAfterDestination(markdown, sourceIndex)
      return linkEnd === -1
        ? null
        : { destinationStart, destinationEnd: sourceIndex, linkEnd }
    }

    sourceIndex += 1
  }

  return null
}

function findLinkClosingAfterDestination(markdown: string, startIndex: number): number {
  let sourceIndex = startIndex

  while (isMarkdownWhitespace(markdown[sourceIndex])) {
    sourceIndex += 1
  }

  if (markdown[sourceIndex] === ')') {
    return sourceIndex + 1
  }

  const openingQuote = markdown[sourceIndex]
  const closingQuote = openingQuote === '(' ? ')' : openingQuote

  if (openingQuote !== '"' && openingQuote !== "'" && openingQuote !== '(') {
    return -1
  }

  sourceIndex += 1

  while (sourceIndex < markdown.length) {
    if (isEscaped(markdown, sourceIndex)) {
      sourceIndex += Math.min(2, markdown.length - sourceIndex)
      continue
    }

    if (markdown[sourceIndex] === closingQuote) {
      sourceIndex += 1
      break
    }

    sourceIndex += 1
  }

  while (isMarkdownWhitespace(markdown[sourceIndex])) {
    sourceIndex += 1
  }

  return markdown[sourceIndex] === ')' ? sourceIndex + 1 : -1
}

function collectProtectionMarkers(
  markdown: string,
  protection: MarkdownProtection,
): string[] {
  const markers: string[] = []
  let sourceIndex = 0

  while (sourceIndex < markdown.length) {
    const markerStart = markdown.indexOf(protection.markerPrefix, sourceIndex)

    if (markerStart === -1) {
      break
    }

    const markerEnd = markdown.indexOf(
      protection.markerSuffix,
      markerStart + protection.markerPrefix.length,
    )

    if (markerEnd === -1) {
      throw new MarkdownStructureError('保护标记不完整')
    }

    markers.push(markdown.slice(markerStart, markerEnd + protection.markerSuffix.length))
    sourceIndex = markerEnd + protection.markerSuffix.length
  }

  return markers
}

function getLines(markdown: string): Line[] {
  const lines: Line[] = []
  let lineStart = 0

  while (lineStart <= markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart)
    const rawEnd = newlineIndex === -1 ? markdown.length : newlineIndex
    const contentEnd =
      rawEnd > lineStart && markdown[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd

    lines.push({
      start: lineStart,
      contentEnd,
      text: markdown.slice(lineStart, contentEnd),
    })

    if (newlineIndex === -1) {
      break
    }

    lineStart = newlineIndex + 1
  }

  return lines
}

function isValidFenceOpening(marker: string, trailingText: string): boolean {
  return marker[0] !== '`' || !trailingText.includes('`')
}

function createMarkerPrefix(markdown: string): string {
  let namespaceIndex = 0
  let markerPrefix = `⟦MDP${namespaceIndex}_`

  while (markdown.includes(markerPrefix)) {
    namespaceIndex += 1
    markerPrefix = `⟦MDP${namespaceIndex}_`
  }

  return markerPrefix
}

function findRangeIndexAtOrAfter(
  ranges: readonly ProtectedRange[],
  sourceIndex: number,
): number {
  return ranges.findIndex((range) => range.end > sourceIndex)
}

function countRun(value: string, startIndex: number, character: string): number {
  let endIndex = startIndex

  while (value[endIndex] === character) {
    endIndex += 1
  }

  return endIndex - startIndex
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0

  for (
    let sourceIndex = index - 1;
    sourceIndex >= 0 && value[sourceIndex] === '\\';
    sourceIndex -= 1
  ) {
    slashCount += 1
  }

  return slashCount % 2 === 1
}

function isMarkdownWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}
