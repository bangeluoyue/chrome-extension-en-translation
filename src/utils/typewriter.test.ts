import { describe, expect, it } from 'vitest'
import { playTypewriterStream } from './typewriter'

describe('playTypewriterStream', () => {
  it('appends new stream content to restored text', async () => {
    const updates: string[] = []

    const output = await playTypewriterStream(
      streamOf('\n\n第二段'),
      (markdown) => updates.push(markdown),
      { initialText: '第一段', intervalMs: 0 },
    )

    expect(output).toBe('第一段\n\n第二段')
    expect(updates.at(-1)).toBe(output)
  })

  it('returns restored text when no new segment is needed', async () => {
    await expect(
      playTypewriterStream(streamOf(), () => undefined, {
        initialText: '完整译文',
        intervalMs: 0,
      }),
    ).resolves.toBe('完整译文')
  })
})

async function* streamOf(...chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk
  }
}
