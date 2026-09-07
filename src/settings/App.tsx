import { FormEvent, useEffect, useState } from 'react'
import './index.css'
import { loadUserConfig, persistUserConfig } from '../services/storageClient'
import type { UserConfig } from '../types'
import { closeCurrentPage } from '../utils/navigation'

const INITIAL_CONFIG: UserConfig = {
  apiKey: '',
  model: 'qwen-plus',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

type FormStatus = 'loading' | 'idle' | 'saving' | 'success' | 'error'

export default function App() {
  const [config, setConfig] = useState<UserConfig>(INITIAL_CONFIG)
  const [status, setStatus] = useState<FormStatus>('loading')
  const [statusMessage, setStatusMessage] = useState('正在读取配置…')

  useEffect(() => {
    let cancelled = false

    loadUserConfig()
      .then((savedConfig) => {
        if (!cancelled) {
          setConfig(savedConfig)
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

  const updateField = (field: keyof UserConfig, value: string) => {
    setConfig((current) => ({ ...current, [field]: value }))
    if (status === 'success' || status === 'error') {
      setStatus('idle')
      setStatusMessage('修改后请点击保存')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    try {
      const normalizedConfig = validateConfig(config)
      setStatus('saving')
      setStatusMessage('正在保存…')
      await persistUserConfig(normalizedConfig)
      setConfig(normalizedConfig)
      setStatus('success')
      setStatusMessage('配置已保存，后续翻译将使用此配置')
    } catch (error) {
      setStatus('error')
      setStatusMessage(getErrorMessage(error, '配置保存失败'))
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
              className="settings__input"
              type="text"
              placeholder="sk-xxxxxxxxxxxxxxxx"
              value={config.apiKey}
              onChange={(event) => updateField('apiKey', event.target.value)}
              autoComplete="off"
              required
              disabled={status === 'loading' || status === 'saving'}
            />
          </label>

          <label className="settings__field">
            <span className="settings__label">模型</span>
            <select
              className="settings__input"
              value={config.model}
              onChange={(event) => updateField('model', event.target.value)}
              required
              disabled={status === 'loading' || status === 'saving'}
            >
              <option value="qwen-plus">qwen-plus</option>
              <option value="qwen-max">qwen-max</option>
            </select>
          </label>

          <label className="settings__field">
            <span className="settings__label">Base URL</span>
            <input
              className="settings__input"
              type="url"
              value={config.baseUrl}
              onChange={(event) => updateField('baseUrl', event.target.value)}
              required
              disabled={status === 'loading' || status === 'saving'}
            />
          </label>

          <button
            className="btn btn--primary"
            type="submit"
            disabled={status === 'loading' || status === 'saving'}
          >
            {status === 'saving' ? '保存中…' : '保存'}
          </button>

          <p className={`settings__status settings__status--${status}`} role="status" aria-live="polite">
            {statusMessage}
          </p>
        </form>
      </main>
    </div>
  )
}

function validateConfig(config: UserConfig): UserConfig {
  const normalizedConfig = {
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    baseUrl: config.baseUrl.trim().replace(/\/$/, ''),
  }

  if (!normalizedConfig.apiKey) {
    throw new Error('API Key 不能为空')
  }

  if (!normalizedConfig.model) {
    throw new Error('模型不能为空')
  }

  let url: URL
  try {
    url = new URL(normalizedConfig.baseUrl)
  } catch {
    throw new Error('Base URL 格式不正确')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Base URL 必须使用 http 或 https 协议')
  }

  return normalizedConfig
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
