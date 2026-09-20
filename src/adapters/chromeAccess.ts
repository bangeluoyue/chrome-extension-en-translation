import { validateTranslationEndpoint } from '../lib/translationEndpoint'

const ARTICLE_EXTRACTOR_FILE = 'content.js'

export async function injectArticleExtractor(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [ARTICLE_EXTRACTOR_FILE],
    })
  } catch {
    throw new Error('无法访问当前页面，请打开普通网页后重新点击翻译')
  }
}

export function getModelEndpointPermissionOrigin(baseUrl: string): string {
  const endpoint = validateTranslationEndpoint(baseUrl)
  const url = new URL(endpoint.baseUrl)

  return `${url.protocol}//${url.hostname}/*`
}

export async function hasModelEndpointPermission(baseUrl: string): Promise<boolean> {
  const origin = getModelEndpointPermissionOrigin(baseUrl)

  return chrome.permissions.contains({ origins: [origin] })
}

export async function assertModelEndpointPermission(baseUrl: string): Promise<void> {
  const endpoint = validateTranslationEndpoint(baseUrl)

  if (!(await hasModelEndpointPermission(endpoint.baseUrl))) {
    throw new Error(
      `未获得模型端点访问权限（${endpoint.host}），请打开设置页，点击保存或测试连接后允许访问`,
    )
  }
}

export async function requestModelEndpointPermission(baseUrl: string): Promise<void> {
  const endpoint = validateTranslationEndpoint(baseUrl)
  const origin = getModelEndpointPermissionOrigin(endpoint.baseUrl)
  const granted = await chrome.permissions.request({ origins: [origin] })

  if (!granted) {
    throw new Error(
      `未获得模型端点访问权限（${endpoint.host}），请再次点击保存或测试连接，并在浏览器提示中选择允许`,
    )
  }
}
