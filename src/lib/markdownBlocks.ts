export type MarkdownBlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code'
  | 'blockquote'
  | 'thematic-break'

export interface MarkdownBlock {
  type: MarkdownBlockType
  markdown: string
  characterCount: number
}

const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const ATX_HEADING_PATTERN = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const SETEXT_HEADING_PATTERN = /^ {0,3}(?:=+|-+)[ \t]*$/
const THEMATIC_BREAK_PATTERN = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/
const LIST_ITEM_PATTERN = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/
const BLOCKQUOTE_PATTERN = /^ {0,3}>/
const INDENTED_CONTENT_PATTERN = /^(?: {2,}|\t)\S/
const TABLE_DELIMITER_PATTERN = /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/

export function getMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let lineIndex = 0

  while (lineIndex < lines.length) {
    if (!lines[lineIndex].trim()) {
      lineIndex += 1
      continue
    }

    const startIndex = lineIndex
    const fenceMatch = lines[lineIndex].match(FENCE_OPEN_PATTERN)

    if (fenceMatch) {
      lineIndex = findFenceEnd(lines, lineIndex + 1, fenceMatch[1])
      blocks.push(createBlock('code', lines, startIndex, lineIndex))
      continue
    }

    if (ATX_HEADING_PATTERN.test(lines[lineIndex])) {
      lineIndex += 1
      blocks.push(createBlock('heading', lines, startIndex, lineIndex))
      continue
    }

    if (isSetextHeadingStart(lines, lineIndex)) {
      lineIndex += 2
      blocks.push(createBlock('heading', lines, startIndex, lineIndex))
      continue
    }

    if (isTableStart(lines, lineIndex)) {
      lineIndex = findTableEnd(lines, lineIndex + 2)
      blocks.push(createBlock('table', lines, startIndex, lineIndex))
      continue
    }

    if (BLOCKQUOTE_PATTERN.test(lines[lineIndex])) {
      lineIndex = findBlockquoteEnd(lines, lineIndex + 1)
      blocks.push(createBlock('blockquote', lines, startIndex, lineIndex))
      continue
    }

    if (THEMATIC_BREAK_PATTERN.test(lines[lineIndex])) {
      lineIndex += 1
      blocks.push(createBlock('thematic-break', lines, startIndex, lineIndex))
      continue
    }

    if (LIST_ITEM_PATTERN.test(lines[lineIndex])) {
      lineIndex = findListEnd(lines, lineIndex + 1)
      blocks.push(createBlock('list', lines, startIndex, lineIndex))
      continue
    }

    lineIndex = findParagraphEnd(lines, lineIndex + 1)
    blocks.push(createBlock('paragraph', lines, startIndex, lineIndex))
  }

  return blocks
}

export function countUnicodeCharacters(value: string): number {
  let characterCount = 0

  for (const _character of value) {
    characterCount += 1
  }

  return characterCount
}

function findFenceEnd(lines: string[], startIndex: number, openingMarker: string): number {
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const fenceMatch = lines[lineIndex].match(FENCE_CLOSE_PATTERN)

    if (
      fenceMatch &&
      fenceMatch[1][0] === openingMarker[0] &&
      fenceMatch[1].length >= openingMarker.length
    ) {
      return lineIndex + 1
    }
  }

  return lines.length
}

function findTableEnd(lines: string[], startIndex: number): number {
  let lineIndex = startIndex

  while (
    lineIndex < lines.length &&
    lines[lineIndex].trim() &&
    lines[lineIndex].includes('|')
  ) {
    lineIndex += 1
  }

  return lineIndex
}

function findBlockquoteEnd(lines: string[], startIndex: number): number {
  let lineIndex = startIndex

  while (lineIndex < lines.length && lines[lineIndex].trim()) {
    if (BLOCKQUOTE_PATTERN.test(lines[lineIndex])) {
      lineIndex += 1
      continue
    }

    if (isStandaloneBlockStart(lines, lineIndex)) {
      break
    }
    lineIndex += 1
  }

  return lineIndex
}

function findListEnd(lines: string[], startIndex: number): number {
  let lineIndex = startIndex

  while (lineIndex < lines.length) {
    if (lines[lineIndex].trim()) {
      if (LIST_ITEM_PATTERN.test(lines[lineIndex])) {
        lineIndex += 1
        continue
      }

      if (isStandaloneBlockStart(lines, lineIndex)) {
        break
      }
      lineIndex += 1
      continue
    }

    let nextContentIndex = lineIndex + 1
    while (nextContentIndex < lines.length && !lines[nextContentIndex].trim()) {
      nextContentIndex += 1
    }

    if (
      nextContentIndex < lines.length &&
      (LIST_ITEM_PATTERN.test(lines[nextContentIndex]) ||
        INDENTED_CONTENT_PATTERN.test(lines[nextContentIndex]))
    ) {
      lineIndex = nextContentIndex
      continue
    }

    break
  }

  return lineIndex
}

function findParagraphEnd(lines: string[], startIndex: number): number {
  let lineIndex = startIndex

  while (lineIndex < lines.length && lines[lineIndex].trim()) {
    if (SETEXT_HEADING_PATTERN.test(lines[lineIndex])) {
      return lineIndex + 1
    }

    if (isStandaloneBlockStart(lines, lineIndex) || isTableStart(lines, lineIndex)) {
      break
    }

    lineIndex += 1
  }

  return lineIndex
}

function isStandaloneBlockStart(lines: string[], lineIndex: number): boolean {
  const line = lines[lineIndex]
  return (
    FENCE_OPEN_PATTERN.test(line) ||
    ATX_HEADING_PATTERN.test(line) ||
    BLOCKQUOTE_PATTERN.test(line) ||
    THEMATIC_BREAK_PATTERN.test(line) ||
    LIST_ITEM_PATTERN.test(line)
  )
}

function isTableStart(lines: string[], lineIndex: number): boolean {
  return (
    lineIndex + 1 < lines.length &&
    lines[lineIndex].includes('|') &&
    TABLE_DELIMITER_PATTERN.test(lines[lineIndex + 1])
  )
}

function isSetextHeadingStart(lines: string[], lineIndex: number): boolean {
  return (
    lineIndex + 1 < lines.length &&
    !isStandaloneBlockStart(lines, lineIndex) &&
    SETEXT_HEADING_PATTERN.test(lines[lineIndex + 1])
  )
}

function createBlock(
  type: MarkdownBlockType,
  lines: string[],
  startIndex: number,
  endIndex: number,
): MarkdownBlock {
  const markdown = lines.slice(startIndex, endIndex).join('\n')

  return {
    type,
    markdown,
    characterCount: countUnicodeCharacters(markdown),
  }
}
