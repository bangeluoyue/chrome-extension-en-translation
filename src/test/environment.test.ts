import { describe, expect, it } from 'vitest'

describe('test environment', () => {
  it('provides browser DOM APIs through jsdom', () => {
    const element = document.createElement('main')
    element.textContent = 'ready'
    document.body.appendChild(element)

    expect(document.querySelector('main')?.textContent).toBe('ready')
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false)
  })

  it('provides an in-memory chrome.storage.local mock', async () => {
    await chrome.storage.local.set({ userConfig: { model: 'test-model' } })

    await expect(chrome.storage.local.get('userConfig')).resolves.toEqual({
      userConfig: { model: 'test-model' },
    })

    await chrome.storage.local.remove('userConfig')
    await expect(chrome.storage.local.get('userConfig')).resolves.toEqual({})
  })

  it('provides basic Chrome runtime and tab mocks', async () => {
    expect(chrome.runtime.getURL('result.html')).toBe(
      'chrome-extension://test-extension-id/result.html',
    )

    await chrome.tabs.create({ url: chrome.runtime.getURL('result.html') })
    expect(chrome.tabs.create).toHaveBeenCalledOnce()
  })
})
