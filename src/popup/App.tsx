import { useEffect, useState } from 'react'
import './index.css'
import { extractArticleFromActiveTab } from '../services/extraction'
import {
  loadLastResult,
  loadUserConfig,
  persistPendingTranslation,
} from '../services/storageClient'
import type { PendingTranslation, TranslationResult } from '../types'
import { openExtensionPage, openReadingWorkspace } from '../utils/navigation'

type ExtractionStatus = 'idle' | 'extracting' | 'success' | 'error'

interface CurrentPageInfo {
  title: string
  site: string
  supported: boolean
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<CurrentPageInfo | null>(null)
  const [lastResult, setLastResult] = useState<TranslationResult | null>(null)
  const [status, setStatus] = useState<ExtractionStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('准备就绪')
  const [hintMessage, setHintMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    loadCurrentPageInfo()
      .then((pageInfo) => {
        if (cancelled) {
          return
        }

        setCurrentPage(pageInfo)
        if (!pageInfo.supported) {
          setStatus('error')
          setStatusMessage('当前页面不支持正文提取')
          setHintMessage('请打开普通的 http 或 https 文章页后重试。')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentPage({ title: '无法读取当前网页', site: '未知来源', supported: false })
          setStatus('error')
          setStatusMessage('无法读取当前标签页')
          setHintMessage('请刷新页面或重新打开扩展后重试。')
        }
      })

    loadLastResult()
      .then((result) => {
        if (!cancelled && result?.translatedMarkdown.trim()) {
          setLastResult(result)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHintMessage('最近一次翻译结果读取失败，但仍可发起新翻译')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleExtract = async () => {
    setStatus('extracting')
    setStatusMessage('提取中…')
    setHintMessage('正在提取正文并准备翻译')

    try {
      const extractedArticle = await extractArticleFromActiveTab()

      setCurrentPage({
        title: extractedArticle.title || '未命名文章',
        site: getSiteLabel(extractedArticle.url),
        supported: true,
      })
      setStatusMessage('正文提取完成，正在检查配置…')

      const config = await loadUserConfig()
      if (!config.apiKey.trim()) {
        throw new Error('未配置 API Key，请先在设置页填写并保存')
      }

      if (!config.model.trim() || !config.baseUrl.trim()) {
        throw new Error('翻译配置不完整，请在设置页检查模型和 Base URL')
      }

      const pending: PendingTranslation = {
        title: extractedArticle.title,
        author: extractedArticle.author,
        sourceUrl: extractedArticle.url,
        originalMarkdown: extractedArticle.markdown,
        createdAt: Date.now(),
      }

      await persistPendingTranslation(pending)
      setStatus('success')
      setStatusMessage('已就绪，正在打开阅读侧边栏…')
      const workspace = await openReadingWorkspace()
      setHintMessage(
        workspace === 'sidepanel'
          ? '翻译将在网页旁的侧边栏中展示'
          : '当前浏览器无法打开侧边栏，已改用结果页',
      )
    } catch (error) {
      setStatus('error')
      const feedback = getWorkflowErrorFeedback(error)
      setStatusMessage(feedback.message)
      setHintMessage(feedback.hint)
    }
  }

  return (
    <div className="popup">
      <header className="popup__header">
        <span className="popup__title">AI 文章阅读助手</span>
        <button
          className="popup__settings"
          type="button"
          onClick={() => openExtensionPage('settings')}
        >
          ⚙ 设置
        </button>
      </header>

      <section className="popup__section">
        <div className="popup__label">当前页面</div>
        <div className="popup__card">
          <div className="popup__article-title">
            {currentPage?.title || '正在读取当前网页…'}
          </div>
          <div className="popup__site">{currentPage?.site || '正在识别来源…'}</div>
        </div>
      </section>

      <button
        className="btn btn--primary"
        type="button"
        onClick={handleExtract}
        disabled={
          status === 'extracting' || currentPage === null || !currentPage.supported
        }
      >
        {status === 'extracting' ? '正在提取…' : '在侧边栏翻译文章'}
      </button>

      {lastResult && (
        <section className="popup__section">
          <div className="popup__label">最近阅读</div>
          <button
            className="popup__recent"
            type="button"
            onClick={() => void openReadingWorkspace()}
          >
            <span className="popup__recent-title">{lastResult.title || '未命名文章'}</span>
            <span className="popup__recent-meta">
              {getSiteLabel(lastResult.sourceUrl)} <span aria-hidden="true">›</span>
            </span>
          </button>
        </section>
      )}

      <div className="popup__feedback" role="status" aria-live="polite">
        <p className={`popup__status popup__status--${status}`}>{statusMessage}</p>
        {hintMessage && <p className="popup__hint">{hintMessage}</p>}
      </div>
    </div>
  )
}

async function loadCurrentPageInfo(): Promise<CurrentPageInfo> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const sourceUrl = activeTab?.url ?? ''
  const supported = /^https?:\/\//i.test(sourceUrl)

  return {
    title: activeTab?.title?.trim() || '未命名页面',
    site: supported ? getSiteLabel(sourceUrl) : '当前页面不可访问',
    supported,
  }
}

function getSiteLabel(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '') || '未知来源'
  } catch {
    return '未知来源'
  }
}

interface WorkflowErrorFeedback {
  message: string
  hint: string
}

function getWorkflowErrorFeedback(error: unknown): WorkflowErrorFeedback {
  if (!(error instanceof Error)) {
    return {
      message: '操作失败',
      hint: '请确认当前标签页是普通网页，并刷新后重试。',
    }
  }

  const message = error.message

  if (message.includes('本地存储空间不足')) {
    return {
      message: '本地存储空间不足，无法保存待翻译文章',
      hint: '请打开最近阅读并删除较早历史，或清理扩展本地数据后重试。',
    }
  }

  if (message.includes('API Key') || message.includes('翻译配置')) {
    return {
      message,
      hint: '请点击右上角“设置”，补全模型配置后重试。',
    }
  }

  if (
    message.includes('Receiving end does not exist') ||
    message.includes('Cannot access') ||
    message.includes('未找到当前标签页')
  ) {
    return {
      message: '当前页面不支持正文提取',
      hint: '请打开普通的 http 或 https 文章页，刷新页面后重试。',
    }
  }

  if (message.includes('存储')) {
    return {
      message: '无法保存待翻译文章',
      hint: '请在扩展管理页重新加载本扩展后重试。',
    }
  }

  if (
    message.includes('未能识别') ||
    message.includes('正文内容为空') ||
    message.includes('无效结果')
  ) {
    return {
      message: '没有识别到可翻译的文章正文',
      hint: '请等待页面加载完成后重试，或换一篇正文结构更清晰的文章。',
    }
  }

  return {
    message: `操作失败：${message}`,
    hint: '请刷新当前文章页后重试。',
  }
}
