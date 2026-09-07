import { useEffect, useState } from 'react'
import './index.css'
import { extractArticleFromActiveTab } from '../services/extraction'
import {
  loadLastResult,
  loadUserConfig,
  persistPendingTranslation,
} from '../services/storageClient'
import type { PendingTranslation, TranslationResult } from '../types'
import type { ExtractedArticle } from '../types/extraction'
import { downloadMarkdown } from '../utils/downloadMarkdown'
import { openExtensionPage } from '../utils/navigation'
import { formatTranslationMarkdown } from '../utils/translationMarkdown'

type ExtractionStatus = 'idle' | 'extracting' | 'success' | 'error'

export default function App() {
  const [article, setArticle] = useState<ExtractedArticle | null>(null)
  const [lastResult, setLastResult] = useState<TranslationResult | null>(null)
  const [status, setStatus] = useState<ExtractionStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('等待提取')
  const [hintMessage, setHintMessage] = useState('提示：翻译完成后即可下载')

  useEffect(() => {
    let cancelled = false

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

    let extractedArticle: ExtractedArticle | null = null

    try {
      extractedArticle = await extractArticleFromActiveTab()

      setArticle(extractedArticle)
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
      setStatusMessage('已就绪，正在打开翻译结果页…')
      setHintMessage('翻译将在结果页以打字机效果展示')
      openExtensionPage('result')
    } catch (error) {
      if (!extractedArticle) {
        setArticle(null)
      }
      setStatus('error')
      const message = getWorkflowErrorMessage(error)
      setStatusMessage(message)
      setHintMessage(getErrorHint(message))
    }
  }

  const handleDownload = () => {
    if (!lastResult?.translatedMarkdown.trim()) {
      return
    }

    try {
      const markdown = formatTranslationMarkdown(lastResult, lastResult.translatedMarkdown)
      downloadMarkdown(markdown, lastResult.title)
      setHintMessage('最近一次翻译结果已开始下载')
    } catch (error) {
      setHintMessage(error instanceof Error ? error.message : '下载失败，请重试')
    }
  }

  const restoredResultVisible = status === 'idle' && !article && lastResult !== null
  const displayTitle = article?.title ?? lastResult?.title ?? '文章标题（提取后显示，最多两行）'
  const displayStatus = restoredResultVisible ? '已恢复最近一次翻译结果' : statusMessage

  return (
    <div className="popup">
      <header className="popup__header">
        <span className="popup__title">网页翻译</span>
        <button className="popup__settings" onClick={() => openExtensionPage('settings')}>
          ⚙ 设置
        </button>
      </header>

      <section className="popup__section">
        <div className="popup__label">当前页面</div>
        <div className="popup__card">
          <div className="popup__article-title">{displayTitle}</div>
          <div className={`popup__status popup__status--${status}`}>
            {restoredResultVisible ? '最近结果' : '提取状态'}：{displayStatus}
          </div>
          {restoredResultVisible && (
            <button className="popup__recent-link" onClick={() => openExtensionPage('result')}>
              查看最近结果 →
            </button>
          )}
        </div>
      </section>

      {article && (
        <section className="popup__section">
          <div className="popup__label">原文 Markdown</div>
          <pre className="popup__markdown">{article.markdown}</pre>
        </section>
      )}

      <button className="btn btn--primary" onClick={handleExtract} disabled={status === 'extracting'}>
        {status === 'extracting' ? '正在提取…' : '一键翻译'}
      </button>
      <button
        className="btn btn--secondary"
        onClick={handleDownload}
        disabled={!lastResult?.translatedMarkdown.trim()}
      >
        下载 Markdown
      </button>

      <p className={`popup__hint ${status === 'error' ? 'popup__hint--error' : ''}`}>{hintMessage}</p>
    </div>
  )
}

function getWorkflowErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return '提取失败'
  }

  if (error.message.includes('Receiving end does not exist')) {
    return '当前页面不可提取或尚未加载内容脚本'
  }

  return error.message
}

function getErrorHint(message: string): string {
  if (message.includes('API Key') || message.includes('翻译配置')) {
    return '请点击右上角“设置”完善翻译配置后重试。'
  }

  if (message.includes('存储')) {
    return '无法保存待翻译内容，请重新加载扩展后重试。'
  }

  return '请确认当前标签页是可访问的普通网页，并刷新后重试。'
}
