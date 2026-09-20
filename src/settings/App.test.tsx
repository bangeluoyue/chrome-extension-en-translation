import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasModelEndpointPermission,
  requestModelEndpointPermission,
} from '../adapters/chromeAccess'
import {
  loadUserConfig,
  persistUserConfig,
  removeUserApiKey,
} from '../services/storageClient'
import { testTranslationConnection } from '../services/translation'
import App from './App'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('../adapters/chromeAccess', () => ({
  hasModelEndpointPermission: vi.fn(),
  requestModelEndpointPermission: vi.fn(),
}))

vi.mock('../services/storageClient', () => ({
  loadUserConfig: vi.fn(),
  persistUserConfig: vi.fn(),
  removeUserApiKey: vi.fn(),
}))

vi.mock('../services/translation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/translation')>()
  return { ...actual, testTranslationConnection: vi.fn() }
})

vi.mock('../utils/navigation', () => ({
  closeCurrentPage: vi.fn(),
}))

const loadUserConfigMock = vi.mocked(loadUserConfig)
const hasModelEndpointPermissionMock = vi.mocked(hasModelEndpointPermission)
const requestModelEndpointPermissionMock = vi.mocked(requestModelEndpointPermission)
const persistUserConfigMock = vi.mocked(persistUserConfig)
const removeUserApiKeyMock = vi.mocked(removeUserApiKey)
const testTranslationConnectionMock = vi.mocked(testTranslationConnection)

let root: Root | null = null

beforeEach(() => {
  hasModelEndpointPermissionMock.mockResolvedValue(true)
  requestModelEndpointPermissionMock.mockResolvedValue(undefined)
  loadUserConfigMock.mockResolvedValue({
    apiKey: 'saved-key',
    model: 'qwen-plus',
    baseUrl: 'https://example.com/v1',
  })
  persistUserConfigMock.mockResolvedValue(undefined)
  removeUserApiKeyMock.mockResolvedValue(undefined)
  testTranslationConnectionMock.mockReset()
  testTranslationConnectionMock.mockResolvedValue(undefined)
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.replaceChildren()
})

describe('settings model configuration', () => {
  it('hides the API key and offers common model suggestions', async () => {
    const container = await renderSettings()
    const apiKeyInput = container.querySelector<HTMLInputElement>('#api-key')
    const modelInput = container.querySelector<HTMLInputElement>('#model')
    const suggestions = Array.from(
      container.querySelectorAll<HTMLOptionElement>('#model-suggestions option'),
      (option) => option.value,
    )

    expect(apiKeyInput?.type).toBe('password')
    expect(modelInput?.tagName).toBe('INPUT')
    expect(modelInput?.getAttribute('list')).toBe('model-suggestions')
    expect(suggestions).toEqual(['qwen-plus', 'qwen-max'])
    expect(container.textContent).toContain(
      '文章正文和划词内容将发送到 example.com',
    )
    expect(container.textContent).toContain('模型端点权限：已允许')
  })

  it('loads and saves a model name outside the suggestion list', async () => {
    loadUserConfigMock.mockResolvedValue({
      apiKey: 'saved-key',
      model: 'custom-model-v2',
      baseUrl: 'https://example.com/v1',
    })

    const container = await renderSettings()
    const modelInput = container.querySelector<HTMLInputElement>('#model')
    const form = container.querySelector<HTMLFormElement>('form')

    expect(modelInput?.value).toBe('custom-model-v2')

    await act(async () => {
      setInputValue(modelInput, 'another-custom-model')
      modelInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(persistUserConfigMock).toHaveBeenCalledWith({
      apiKey: 'saved-key',
      model: 'another-custom-model',
      baseUrl: 'https://example.com/v1',
    })
    expect(requestModelEndpointPermissionMock).toHaveBeenCalledWith(
      'https://example.com/v1',
    )
    expect(
      requestModelEndpointPermissionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(persistUserConfigMock.mock.invocationCallOrder[0])
  })

  it('tests the current form values without saving them', async () => {
    let resolveConnection: (() => void) | undefined
    testTranslationConnectionMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnection = resolve
        }),
    )

    const container = await renderSettings()
    const apiKeyInput = container.querySelector<HTMLInputElement>('#api-key')
    const modelInput = container.querySelector<HTMLInputElement>('#model')
    const baseUrlInput = container.querySelector<HTMLInputElement>('#base-url')
    const testButton = getTestButton(container)

    await act(async () => {
      setInputValue(apiKeyInput, 'unsaved-key')
      apiKeyInput?.dispatchEvent(new Event('input', { bubbles: true }))
      setInputValue(modelInput, 'unsaved-custom-model')
      modelInput?.dispatchEvent(new Event('input', { bubbles: true }))
      setInputValue(baseUrlInput, 'https://unsaved.example/v1/')
      baseUrlInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      testButton.click()
      await Promise.resolve()
    })

    expect(testTranslationConnectionMock).toHaveBeenCalledTimes(1)
    expect(testTranslationConnectionMock).toHaveBeenCalledWith({
      apiKey: 'unsaved-key',
      model: 'unsaved-custom-model',
      baseUrl: 'https://unsaved.example/v1',
    })
    expect(requestModelEndpointPermissionMock).toHaveBeenCalledWith(
      'https://unsaved.example/v1',
    )
    expect(
      requestModelEndpointPermissionMock.mock.invocationCallOrder[0],
    ).toBeLessThan(testTranslationConnectionMock.mock.invocationCallOrder[0])
    expect(testButton.disabled).toBe(true)
    expect(testButton.textContent).toBe('测试中…')

    testButton.click()
    expect(testTranslationConnectionMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveConnection?.()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('连接成功：模型可以正常响应')
    expect(persistUserConfigMock).not.toHaveBeenCalled()
  })

  it.each([
    ['401 Unauthorized', 'API Key 无效或已失效'],
    ['404 model_not_found', '模型名称或 Base URL 不正确'],
  ])('shows a categorized connection error for %s', async (error, expectedMessage) => {
    testTranslationConnectionMock.mockRejectedValue(new Error(error))
    const container = await renderSettings()
    const testButton = getTestButton(container)

    await act(async () => {
      testButton.click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain(expectedMessage)
    expect(persistUserConfigMock).not.toHaveBeenCalled()
  })

  it('blocks saving and testing an insecure non-local HTTP endpoint', async () => {
    const container = await renderSettings()
    const baseUrlInput = container.querySelector<HTMLInputElement>('#base-url')
    const form = container.querySelector<HTMLFormElement>('form')

    await act(async () => {
      setInputValue(baseUrlInput, 'http://api.example.com/v1')
      baseUrlInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(baseUrlInput?.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain(
      'Base URL 必须使用 HTTPS；HTTP 仅限 localhost 或 127.0.0.1',
    )

    await act(async () => {
      getTestButton(container).click()
      await Promise.resolve()
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(testTranslationConnectionMock).not.toHaveBeenCalled()
    expect(persistUserConfigMock).not.toHaveBeenCalled()
    expect(requestModelEndpointPermissionMock).not.toHaveBeenCalled()
  })

  it('keeps the configuration unchanged and explains how to retry after permission denial', async () => {
    requestModelEndpointPermissionMock.mockRejectedValueOnce(
      new Error(
        '未获得模型端点访问权限（example.com），请再次点击保存或测试连接，并在浏览器提示中选择允许',
      ),
    )
    const container = await renderSettings()
    const form = container.querySelector<HTMLFormElement>('form')

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('请再次点击保存或测试连接')
    expect(container.textContent).toContain('模型端点权限：未允许')
    expect(persistUserConfigMock).not.toHaveBeenCalled()
    expect(testTranslationConnectionMock).not.toHaveBeenCalled()
  })

  it('allows a local HTTP debugging endpoint for testing and saving', async () => {
    const container = await renderSettings()
    const baseUrlInput = container.querySelector<HTMLInputElement>('#base-url')
    const form = container.querySelector<HTMLFormElement>('form')

    await act(async () => {
      setInputValue(baseUrlInput, 'http://localhost:3000/v1/')
      baseUrlInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(baseUrlInput?.getAttribute('aria-invalid')).toBe('false')
    expect(container.textContent).toContain(
      '文章正文和划词内容将发送到 localhost:3000（不安全的本机 HTTP 调试连接）',
    )

    await act(async () => {
      getTestButton(container).click()
      await Promise.resolve()
    })

    expect(testTranslationConnectionMock).toHaveBeenCalledWith({
      apiKey: 'saved-key',
      model: 'qwen-plus',
      baseUrl: 'http://localhost:3000/v1',
    })

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(persistUserConfigMock).toHaveBeenCalledWith({
      apiKey: 'saved-key',
      model: 'qwen-plus',
      baseUrl: 'http://localhost:3000/v1',
    })
  })

  it('clears the saved API key after confirmation without changing other fields', async () => {
    const container = await renderSettings()
    const apiKeyInput = container.querySelector<HTMLInputElement>('#api-key')
    const modelInput = container.querySelector<HTMLInputElement>('#model')
    const baseUrlInput = container.querySelector<HTMLInputElement>('#base-url')

    await act(async () => {
      getButton(container, '清除 API Key').click()
    })

    expect(getButton(container, '确认清除')).toBeTruthy()
    expect(removeUserApiKeyMock).not.toHaveBeenCalled()

    await act(async () => {
      getButton(container, '确认清除').click()
      await Promise.resolve()
    })

    expect(removeUserApiKeyMock).toHaveBeenCalledOnce()
    expect(apiKeyInput?.value).toBe('')
    expect(modelInput?.value).toBe('qwen-plus')
    expect(baseUrlInput?.value).toBe('https://example.com/v1')
    expect(container.textContent).toContain('API Key 已清除')
    expect(persistUserConfigMock).not.toHaveBeenCalled()
  })
})

async function renderSettings(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<App />)
    await Promise.resolve()
  })

  return container
}

function setInputValue(input: HTMLInputElement | null, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, value)
}

function getTestButton(container: HTMLDivElement): HTMLButtonElement {
  return getButton(container, '测试连接')
}

function getButton(container: HTMLDivElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent === label,
  )

  if (!button) {
    throw new Error(`未找到按钮：${label}`)
  }

  return button
}
