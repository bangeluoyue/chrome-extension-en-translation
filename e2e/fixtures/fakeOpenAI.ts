import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeModelRequest {
  stream: boolean
  userContent: string
  receivedAt: number
}

export interface FakeOpenAIService {
  articleUrl: string
  baseUrl: string
  requests: FakeModelRequest[]
  close: () => Promise<void>
}

export async function startFakeOpenAIService(): Promise<FakeOpenAIService> {
  const requests: FakeModelRequest[] = []
  const server = createServer((request, response) => {
    void handleRequest(request, response, requests)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`

  return {
    articleUrl: `${origin}/article`,
    baseUrl: `${origin}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: FakeModelRequest[],
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  if (request.method === 'OPTIONS') {
    writeCorsHeaders(response)
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'GET' && url.pathname === '/article') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(createLongArticleHtml())
    return
  }

  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'Not found' } }))
    return
  }

  const body = await readJsonBody(request)
  const userContent = getUserContent(body)
  const stream = body.stream === true
  requests.push({ stream, userContent, receivedAt: Date.now() })
  writeCorsHeaders(response)

  if (!stream) {
    const isConnectionTest = body.max_tokens === 1
    const content = isConnectionTest ? 'OK' : '划词译文：浏览器解析 HTML。'
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion',
        created: 1,
        model: 'e2e-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      }),
    )
    return
  }

  const requestNumber = requests.filter((entry) => entry.stream).length
  const markers = userContent.match(/⟦MDP[^⟧]+⟧/g) ?? []
  const translated = [
    `## E2E_SEGMENT_TRANSLATION_${requestNumber}`,
    '',
    `第 ${requestNumber} 段已由本地假模型翻译。`,
    '',
    ...markers,
  ].join('\n')

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })

  for (const content of splitText(translated, 37)) {
    response.write(
      `data: ${JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'e2e-model',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
    )
  }

  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  )
  response.end('data: [DONE]\n\n')
}

function writeCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-headers', 'authorization, content-type')
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''

  for await (const chunk of request) {
    body += chunk.toString()
  }

  return JSON.parse(body) as Record<string, unknown>
}

function getUserContent(body: Record<string, unknown>): string {
  if (!Array.isArray(body.messages)) {
    return ''
  }

  const userMessage = [...body.messages]
    .reverse()
    .find(
      (message): message is { role: string; content: string } =>
        typeof message === 'object' &&
        message !== null &&
        (message as Record<string, unknown>).role === 'user' &&
        typeof (message as Record<string, unknown>).content === 'string',
    )

  return userMessage?.content ?? ''
}

function splitText(value: string, chunkSize: number): string[] {
  const chunks: string[] = []

  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize))
  }

  return chunks
}

function createLongArticleHtml(): string {
  const repeatedText =
    'Browser extensions extract readable content and translate each Markdown block in order. '
  const sections = Array.from({ length: 4 }, (_, index) => {
    const sentinel = index === 0 ? 'E2E_ORIGINAL_SENTINEL. ' : ''
    return `
      <section>
        <h2>Reliable workflow ${index + 1}</h2>
        <p>${sentinel}${repeatedText.repeat(105)}</p>
        <p>Use <code>chrome.scripting</code> with <a href="https://example.invalid/reference-${index + 1}">documented boundaries</a>.</p>
      </section>`
  }).join('')

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="author" content="E2E Author">
        <title>E2E Long Article</title>
      </head>
      <body>
        <nav>Navigation should not be extracted.</nav>
        <article>
          <h1>E2E Long Article</h1>
          <p>This fixture verifies a production MV3 extension without a real model key.</p>
          ${sections}
        </article>
      </body>
    </html>`
}
