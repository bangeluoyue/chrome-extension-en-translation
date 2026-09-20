import { describe, expect, it, vi } from 'vitest'
import {
  assertModelEndpointPermission,
  getModelEndpointPermissionOrigin,
  injectArticleExtractor,
  requestModelEndpointPermission,
} from './chromeAccess'

describe('Chrome access adapter', () => {
  it.each([
    ['https://api.example.com:8443/v1', 'https://api.example.com/*'],
    ['http://localhost:3000/v1', 'http://localhost/*'],
    ['http://127.0.0.1:8080/v1', 'http://127.0.0.1/*'],
  ])('maps %s to the narrowest supported origin pattern', (baseUrl, expected) => {
    expect(getModelEndpointPermissionOrigin(baseUrl)).toBe(expected)
  })

  it('injects the article extractor into the active tab only', async () => {
    await injectArticleExtractor(42)

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['content.js'],
    })
  })

  it('turns an injection failure into an actionable page-access error', async () => {
    vi.mocked(chrome.scripting.executeScript).mockRejectedValueOnce(new Error('blocked'))

    await expect(injectArticleExtractor(42)).rejects.toThrow(
      '无法访问当前页面，请打开普通网页后重新点击翻译',
    )
  })

  it('requests only the configured model host and accepts permission', async () => {
    await requestModelEndpointPermission('https://api.example.com:8443/v1')

    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['https://api.example.com/*'],
    })
  })

  it('explains how to recover when endpoint permission is denied', async () => {
    const requestPermissionMock = vi.mocked(
      chrome.permissions.request as unknown as (permissions: object) => Promise<boolean>,
    )
    requestPermissionMock.mockResolvedValueOnce(false)

    await expect(
      requestModelEndpointPermission('https://api.example.com/v1'),
    ).rejects.toThrow('请再次点击保存或测试连接，并在浏览器提示中选择允许')
  })

  it('directs an existing configuration without permission back to Settings', async () => {
    const containsPermissionMock = vi.mocked(
      chrome.permissions.contains as unknown as (permissions: object) => Promise<boolean>,
    )
    containsPermissionMock.mockResolvedValueOnce(false)

    await expect(
      assertModelEndpointPermission('https://api.example.com/v1'),
    ).rejects.toThrow('请打开设置页，点击保存或测试连接后允许访问')
  })
})
