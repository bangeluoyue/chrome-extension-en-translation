import { LONG_ARTICLE_CHARACTER_THRESHOLD } from './articleSizePreflight'
import {
  countUnicodeCharacters,
  getMarkdownBlocks,
  type MarkdownBlock,
} from './markdownBlocks'

export function splitMarkdownIntoSegments(
  markdown: string,
  maximumSegmentCharacters = LONG_ARTICLE_CHARACTER_THRESHOLD,
): string[] {
  if (!Number.isInteger(maximumSegmentCharacters) || maximumSegmentCharacters <= 0) {
    throw new RangeError('分段字符上限必须是正整数')
  }

  if (countUnicodeCharacters(markdown) <= maximumSegmentCharacters) {
    return [markdown]
  }

  const blocks = getMarkdownBlocks(markdown)

  if (blocks.length === 0) {
    return [markdown]
  }

  const segments: string[] = []
  let pendingBlocks: MarkdownBlock[] = []
  let pendingCharacterCount = 0

  for (const block of blocks) {
    const candidateCharacterCount =
      pendingCharacterCount + (pendingBlocks.length > 0 ? 2 : 0) + block.characterCount

    if (candidateCharacterCount <= maximumSegmentCharacters) {
      pendingBlocks.push(block)
      pendingCharacterCount = candidateCharacterCount
      continue
    }

    const trailingHeadingIndex = findTrailingHeadingIndex(pendingBlocks)

    if (
      trailingHeadingIndex > 0 &&
      trailingHeadingIndex < pendingBlocks.length
    ) {
      segments.push(joinBlocks(pendingBlocks.slice(0, trailingHeadingIndex)))
      pendingBlocks = pendingBlocks.slice(trailingHeadingIndex)
      pendingCharacterCount = getCombinedCharacterCount(pendingBlocks)

      if (
        pendingCharacterCount + 2 + block.characterCount <=
        maximumSegmentCharacters
      ) {
        pendingBlocks.push(block)
        pendingCharacterCount += 2 + block.characterCount
        continue
      }
    }

    if (pendingBlocks.length > 0) {
      segments.push(joinBlocks(pendingBlocks))
    }

    pendingBlocks = [block]
    pendingCharacterCount = block.characterCount
  }

  if (pendingBlocks.length > 0) {
    segments.push(joinBlocks(pendingBlocks))
  }

  return segments
}

function findTrailingHeadingIndex(blocks: MarkdownBlock[]): number {
  let blockIndex = blocks.length

  while (blockIndex > 0 && blocks[blockIndex - 1].type === 'heading') {
    blockIndex -= 1
  }

  return blockIndex
}

function getCombinedCharacterCount(blocks: MarkdownBlock[]): number {
  if (blocks.length === 0) {
    return 0
  }

  return (
    blocks.reduce((total, block) => total + block.characterCount, 0) +
    (blocks.length - 1) * 2
  )
}

function joinBlocks(blocks: MarkdownBlock[]): string {
  return blocks.map((block) => block.markdown).join('\n\n')
}
