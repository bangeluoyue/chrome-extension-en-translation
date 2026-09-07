const DEFAULT_INTERVAL_MS = 20

export interface TypewriterOptions {
  intervalMs?: number
  signal?: AbortSignal
}

export async function playTypewriterStream(
  stream: AsyncIterable<string>,
  onUpdate: (markdown: string) => void,
  options: TypewriterOptions = {},
): Promise<string> {
  const { intervalMs = DEFAULT_INTERVAL_MS, signal } = options
  let buffer = ''
  let output = ''
  let producerFinished = false
  let producerError: unknown
  const consumerSignal: { wake?: () => void } = {}

  // 网络流持续写入缓冲区，渲染循环按自己的节奏消费，避免打字速度阻塞 SSE 读取。
  const producer = (async () => {
    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          break
        }

        if (chunk) {
          buffer += chunk
          consumerSignal.wake?.()
        }
      }
    } catch (error) {
      producerError = error
    } finally {
      producerFinished = true
      consumerSignal.wake?.()
    }
  })()

  while (!signal?.aborted && (!producerFinished || buffer)) {
    if (!buffer) {
      await waitForBufferedText(
        () => Boolean(buffer) || producerFinished,
        (wake) => {
          consumerSignal.wake = wake
        },
        signal,
      )
      consumerSignal.wake = undefined
      continue
    }

    const [nextText, remainingText] = takeCharacters(buffer, getBatchSize(buffer.length))
    buffer = remainingText
    output += nextText
    onUpdate(output)
    await wait(intervalMs, signal)
  }

  if (signal?.aborted) {
    return output
  }

  await producer

  if (producerError) {
    throw producerError
  }

  return output
}

function getBatchSize(bufferLength: number): number {
  if (bufferLength > 600) {
    return 8
  }

  if (bufferLength > 240) {
    return 4
  }

  return bufferLength > 80 ? 2 : 1
}

function takeCharacters(value: string, count: number): [string, string] {
  let endIndex = 0
  let charactersTaken = 0

  while (endIndex < value.length && charactersTaken < count) {
    const codePoint = value.codePointAt(endIndex)
    endIndex += codePoint !== undefined && codePoint > 0xffff ? 2 : 1
    charactersTaken += 1
  }

  return [value.slice(0, endIndex), value.slice(endIndex)]
}

function waitForBufferedText(
  isReady: () => boolean,
  subscribe: (wake: () => void) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) {
        return
      }

      settled = true
      signal?.removeEventListener('abort', finish)
      resolve()
    }

    subscribe(finish)
    signal?.addEventListener('abort', finish, { once: true })

    if (isReady() || signal?.aborted) {
      finish()
    }
  })
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0 || signal?.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)

    signal?.addEventListener('abort', finish, { once: true })
  })
}
