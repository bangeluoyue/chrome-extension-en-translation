export interface TranslationEndpoint {
  baseUrl: string
  host: string
  isLocalHttp: boolean
}

const LOCAL_HTTP_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

export function validateTranslationEndpoint(baseUrl: string): TranslationEndpoint {
  const trimmedBaseUrl = baseUrl.trim()

  if (!trimmedBaseUrl) {
    throw new Error('Base URL 不能为空')
  }

  let url: URL

  try {
    url = new URL(trimmedBaseUrl)
  } catch {
    throw new Error('Base URL 格式不正确')
  }

  const isLocalHttp =
    url.protocol === 'http:' && LOCAL_HTTP_HOSTNAMES.has(url.hostname)

  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('Base URL 必须使用 HTTPS；HTTP 仅限 localhost 或 127.0.0.1')
  }

  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  const normalizedBaseUrl =
    url.pathname === '/' && !url.search && !url.hash ? url.origin : url.toString()

  return {
    baseUrl: normalizedBaseUrl,
    host: url.host,
    isLocalHttp,
  }
}
