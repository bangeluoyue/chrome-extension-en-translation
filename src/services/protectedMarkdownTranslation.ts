import {
  MarkdownStructureError,
  protectMarkdownStructure,
  restoreProtectedMarkdown,
  type MarkdownProtection,
} from '../lib/markdownProtection'
import type { UserConfig } from '../types'
import { translateMarkdownStream } from './translation'

export async function* translateProtectedMarkdownStream(
  markdown: string,
  config: UserConfig,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const protection = protectMarkdownStructure(markdown)
  const restorer = new StreamingMarkdownRestorer(protection)
  let rawTranslation = ''
  let restoredTranslation = ''

  for await (const chunk of translateMarkdownStream(
    protection.protectedMarkdown,
    config,
    signal,
  )) {
    rawTranslation += chunk

    for (const restoredChunk of restorer.push(chunk)) {
      restoredTranslation += restoredChunk
      yield restoredChunk
    }
  }

  const trailingChunks = restorer.finish()

  for (const trailingChunk of trailingChunks) {
    restoredTranslation += trailingChunk
  }

  const validatedTranslation = restoreProtectedMarkdown(rawTranslation, protection)

  if (restoredTranslation !== validatedTranslation) {
    throw new MarkdownStructureError('保护内容恢复结果不一致')
  }

  for (const trailingChunk of trailingChunks) {
    yield trailingChunk
  }
}

class StreamingMarkdownRestorer {
  private pending = ''
  private tokenIndex = 0

  constructor(private readonly protection: MarkdownProtection) {}

  push(chunk: string): string[] {
    this.pending += chunk
    return this.drain(false)
  }

  finish(): string[] {
    const chunks = this.drain(true)

    if (this.tokenIndex !== this.protection.tokens.length) {
      throw new MarkdownStructureError('保护标记数量不一致')
    }

    return chunks
  }

  private drain(flush: boolean): string[] {
    const chunks: string[] = []

    while (this.pending) {
      const markerStart = this.pending.indexOf(this.protection.markerPrefix)

      if (markerStart === -1) {
        const retainedLength = flush
          ? 0
          : getPartialPrefixLength(this.pending, this.protection.markerPrefix)
        const availableLength = this.pending.length - retainedLength

        if (availableLength > 0) {
          chunks.push(this.pending.slice(0, availableLength))
          this.pending = this.pending.slice(availableLength)
        }

        break
      }

      if (markerStart > 0) {
        chunks.push(this.pending.slice(0, markerStart))
        this.pending = this.pending.slice(markerStart)
        continue
      }

      const markerEnd = this.pending.indexOf(
        this.protection.markerSuffix,
        this.protection.markerPrefix.length,
      )

      if (markerEnd === -1) {
        if (flush) {
          throw new MarkdownStructureError('保护标记不完整')
        }

        break
      }

      const candidateMarker = this.pending.slice(
        0,
        markerEnd + this.protection.markerSuffix.length,
      )
      const expectedToken = this.protection.tokens[this.tokenIndex]

      if (!expectedToken || candidateMarker !== expectedToken.marker) {
        throw new MarkdownStructureError('保护标记顺序或内容发生变化')
      }

      chunks.push(expectedToken.value)
      this.tokenIndex += 1
      this.pending = this.pending.slice(candidateMarker.length)
    }

    return chunks
  }
}

function getPartialPrefixLength(value: string, prefix: string): number {
  const maximumLength = Math.min(value.length, prefix.length - 1)

  for (let length = maximumLength; length > 0; length -= 1) {
    if (prefix.startsWith(value.slice(-length))) {
      return length
    }
  }

  return 0
}
