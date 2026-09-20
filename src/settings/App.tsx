import { FormEvent, useEffect, useState } from 'react'
import './index.css'
import {
  hasModelEndpointPermission,
  requestModelEndpointPermission,
} from '../adapters/chromeAccess'
import { validateTranslationEndpoint } from '../lib/translationEndpoint'
import {
  loadUserConfig,
  persistUserConfig,
  removeUserApiKey,
} from '../services/storageClient'
import { getTranslationErrorInfo, testTranslationConnection } from '../services/translation'
import type { UserConfig } from '../types'
import { closeCurrentPage } from '../utils/navigation'

const INITIAL_CONFIG: UserConfig = {
  apiKey: '',
  model: 'qwen-plus',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

const MODEL_SUGGESTIONS = ['qwen-plus', 'qwen-max'] as const

type FormStatus =
  | 'loading'
  | 'idle'
  | 'saving'
  | 'testing'
  | 'clearing'
  | 'success'
  | 'error'

type EndpointPermissionStatus = 'checking' | 'granted' | 'missing' | 'invalid'

export default function App() {
  const [config, setConfig] = useState<UserConfig>(INITIAL_CONFIG)
  const [status, setStatus] = useState<FormStatus>('loading')
  const [statusMessage, setStatusMessage] = useState('正在读取配置…')
  const [clearConfirmation, setClearConfirmation] = useState(false)
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false)
  const [endpointPermissionStatus, setEndpointPermissionStatus] =
    useState<EndpointPermissionStatus>('checking')
  const endpointPreview = getEndpointPreview(config.baseUrl)

  useEffect(() => {
    let cancelled = false

    loadUserConfig()
      .then((savedConfig) => {
        if (!cancelled) {
          setConfig(savedConfig)
          setHasSavedApiKey(Boolean(savedConfig.apiKey))
          setStatus('idle')
          setStatusMessage('API Key 仅保存在本地浏览器中')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus('error')
          setStatusMessage(getErrorMessage(error, '配置读取失败'))
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!endpointPreview.valid) {
      setEndpointPermissionStatus('invalid')
      return () => {
        cancelled = true
      }
    }

    setEndpointPermissionStatus('checking')
    hasModelEndpointPermission(config.baseUrl)
      .then((granted) => {
        if (!cancelled) {
          setEndpointPermissionStatus(granted ? 'granted' : 'missing')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEndpointPermissionStatus('missing')
        }
      })

    return () => {
      cancelled = true
    }
  }, [config.baseUrl, endpointPreview.valid])

  const updateField = (field: keyof UserConfig, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }))
    setClearConfirmation(false)
    if (status === 'success' || status === 'error') {
      setStatus('idle')
      setStatusMessage('修改后请点击保存')
    }
  }

  const handleTestConnection = async () => {
    setClearConfirmation(false)

    try {
      const normalizedConfig = validateConfig(config)
      setStatus('testing')
      setStatusMessage('正在申请模型端点权限…')
      await requestModelEndpointPermission(normalizedConfig.baseUrl)
      setEndpointPermissionStatus('granted')
      setStatusMessage('正在测试连接…')
      await testTranslationConnection(normalizedConfig)
      setStatus('success')
      setStatusMessage('连接成功：模型可以正常响应')
    } catch (error) {
      if (isEndpointPermissionDenial(error)) {
        setEndpointPermissionStatus('missing')
      }
      setStatus('error')
      setStatusMessage(getConnectionErrorMessage(error))
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setClearConfirmation(false)

    try {
      const normalizedConfig = validateConfig(config)
      setStatus('saving')
      setStatusMessage('正在申请模型端点权限…')
      await requestModelEndpointPermission(normalizedConfig.baseUrl)
      setEndpointPermissionStatus('granted')
      setStatusMessage('正在保存…')
      await persistUserConfig(normalizedConfig)
      setConfig(normalizedConfig)
      setHasSavedApiKey(true)
      setStatus('success')
      setStatusMessage('配置已保存，后续翻译将使用此配置')
    } catch (error) {
      if (isEndpointPermissionDenial(error)) {
        setEndpointPermissionStatus('missing')
      }
      setStatus('error')
      setStatusMessage(getErrorMessage(error, '配置保存失败'))
    }
  }

  const handleClearApiKey = async () => {
    if (!clearConfirmation) {
      setClearConfirmation(true)
      setStatus('idle')
      setStatusMessage('再次点击“确认清除”将删除本地保存的 API Key')
      return
    }

    setStatus('clearing')
    setStatusMessage('正在清除 API Key…')

    try {
      await removeUserApiKey()
      setConfig((current) => ({ ...current, apiKey: '' }))
      setHasSavedApiKey(false)
      setClearConfirmation(false)
      setStatus('success')
      setStatusMessage('API Key 已清除，模型和 Base URL 保持不变')
    } catch (error) {
      setStatus('error')
      setStatusMessage(getErrorMessage(error, 'API Key 清除失败'))
    }
  }

  return (
    <div className="settings">
      <header className="settings__header">
        <button className="settings__back" onClick={closeCurrentPage}>
          ← 返回
        </button>
        <span className="settings__title">设置</span>
      </header>

      <main className="settings__body">
        <form className="settings__form" onSubmit={handleSubmit}>
          <label className="settings__field">
            <span className="settings__label">API Key</span>
            <input
              id="api-key"
              className="settings__input"
              type="password"
              placeholder="sk-xxxxxxxxxxxxxxxx"
              value={config.apiKey}
              onChange={(event) => updateField('apiKey', event.target.value)}
              autoComplete="off"
              required
              disabled={isFormBusy(status)}
            />
          </label>

          <label className="settings__field">
            <span className="settings__label">模型</span>
            <input
              id="model"
              className="settings__input"
              type="text"
              list="model-suggestions"
              aria-describedby="model-description"
              placeholder="例如 qwen-plus"
              value={config.model}
              onChange={(event) => updateField('model', event.target.value)}
              autoComplete="off"
              required
              disabled={isFormBusy(status)}
            />
            <datalist id="model-suggestions">
              {MODEL_SUGGESTIONS.map((model) => (
                <option value={model} key={model} />
              ))}
            </datalist>
            <span className="settings__description" id="model-description">
              可输入任意 OpenAI 兼容模型名称
            </span>
          </label>

          <label className="settings__field">
            <span className="settings__label">Base URL</span>
            <input
              id="base-url"
              className="settings__input"
              type="url"
              aria-describedby="base-url-description endpoint-permission-description"
              aria-invalid={!endpointPreview.valid}
              value={config.baseUrl}
              onChange={(event) => updateField('baseUrl', event.target.value)}
              required
              disabled={isFormBusy(status)}
            />
            <span
              className={`settings__description ${
                endpointPreview.valid
                  ? endpointPreview.isLocalHttp
                    ? 'settings__description--warning'
                    : ''
                  : 'settings__description--error'
              }`}
              id="base-url-description"
            >
              {endpointPreview.valid
                ? `文章正文和划词内容将发送到 ${endpointPreview.host}${
                    endpointPreview.isLocalHttp ? '（不安全的本机 HTTP 调试连接）' : ''
                  }`
                : endpointPreview.message}
            </span>
            <span
              className={`settings__description ${
                endpointPermissionStatus === 'missing'
                  ? 'settings__description--warning'
                  : ''
              }`}
              id="endpoint-permission-description"
            >
              {getEndpointPermissionMessage(endpointPermissionStatus)}
            </span>
          </label>

          <div className="settings__actions">
            <button
              className={`btn btn--secondary settings__clear-key ${
                clearConfirmation ? 'settings__clear-key--confirm' : ''
              }`}
              type="button"
              onClick={() => void handleClearApiKey()}
              disabled={isFormBusy(status) || (!hasSavedApiKey && !config.apiKey)}
            >
              {status === 'clearing'
                ? '清除中…'
                : clearConfirmation
                  ? '确认清除'
                  : '清除 API Key'}
            </button>
            <div className="settings__primary-actions">
              <button
                className="btn btn--secondary"
                type="button"
                onClick={handleTestConnection}
                disabled={isFormBusy(status)}
              >
                {status === 'testing' ? '测试中…' : '测试连接'}
              </button>
              <button
                className="btn btn--primary"
                type="submit"
                disabled={isFormBusy(status)}
              >
                {status === 'saving' ? '保存中…' : '保存'}
              </button>
            </div>
          </div>

          <p className={`settings__status settings__status--${status}`} role="status" aria-live="polite">
            {statusMessage}
          </p>
        </form>
      </main>
    </div>
  )
}

function validateConfig(config: UserConfig): UserConfig {
  const trimmedConfig = {
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    baseUrl: config.baseUrl,
  }

  if (!trimmedConfig.apiKey) {
    throw new Error('API Key 不能为空')
  }

  if (!trimmedConfig.model) {
    throw new Error('模型不能为空')
  }

  const endpoint = validateTranslationEndpoint(trimmedConfig.baseUrl)

  return { ...trimmedConfig, baseUrl: endpoint.baseUrl }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function getConnectionErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    (['API Key 不能为空', '模型不能为空'].includes(error.message) ||
      error.message.startsWith('Base URL'))
  ) {
    return error.message
  }

  return getTranslationErrorInfo(error).message
}

function isEndpointPermissionDenial(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('未获得模型端点访问权限')
}

function isFormBusy(status: FormStatus): boolean {
  return (
    status === 'loading' ||
    status === 'saving' ||
    status === 'testing' ||
    status === 'clearing'
  )
}

type EndpointPreview =
  | { valid: true; host: string; isLocalHttp: boolean }
  | { valid: false; message: string }

function getEndpointPreview(baseUrl: string): EndpointPreview {
  try {
    const endpoint = validateTranslationEndpoint(baseUrl)
    return {
      valid: true,
      host: endpoint.host,
      isLocalHttp: endpoint.isLocalHttp,
    }
  } catch (error) {
    return {
      valid: false,
      message: getErrorMessage(error, 'Base URL 格式不正确'),
    }
  }
}

function getEndpointPermissionMessage(status: EndpointPermissionStatus): string {
  if (status === 'checking') {
    return '模型端点权限：正在检查…'
  }

  if (status === 'granted') {
    return '模型端点权限：已允许'
  }

  if (status === 'invalid') {
    return '模型端点权限：请先填写有效的 Base URL'
  }

  return '模型端点权限：未允许；请点击“测试连接”或“保存”，并在浏览器提示中选择允许'
}
