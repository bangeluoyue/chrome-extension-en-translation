import { MarkdownRenderer } from 'md-wx'
import 'md-wx/dist/style.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import {
  loadLastResult,
  loadPendingTranslation,
  loadUserConfig,
  persistLastResult,
  removePendingTranslation,
} from '../services/storageClient'
import { getTranslationErrorMessage, translateMarkdownStream } from '../services/translation'
import type { TranslationResult } from '../types'
import { copyTextToClipboard } from '../utils/clipboard'
import { downloadMarkdown } from '../utils/downloadMarkdown'
import { closeCurrentPage } from '../utils/navigation'
import { formatTranslationMarkdown } from '../utils/translationMarkdown'
import { playTypewriterStream } from '../utils/typewriter'

type ResultStatus = 'loading' | 'streaming' | 'complete' | 'empty' | 'error'
type CopyStatus = 'idle' | 'copying' | 'success' | 'error'
type DownloadStatus = 'idle' | 'success' | 'error'

export default function App() {
  const [article, setArticle] = useState<TranslationResult | null>(null)
  const [translatedMarkdown, setTranslatedMarkdown] = useState('')
  const [status, setStatus] = useState<ResultStatus>('loading')
  const [statusMessage, setStatusMessage] = useState('正在读取文章…')
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle')
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle')
  const copyResetTimer = useRef<number>()
  const downloadResetTimer = useRef<number>()

  useEffect(() => {
    const controller = new AbortController()

    const initializeResult = async () => {
      try {
        const [storedResult, pending] = await Promise.all([
          loadLastResult(),
          loadPendingTranslation(),
        ])

        if (controller.signal.aborted) {
          return
        }

        const shouldUsePending =
          pending !== null && (!storedResult || pending.createdAt >= storedResult.createdAt)
        const sourceResult: TranslationResult | null = shouldUsePending
          ? { ...pending, translatedMarkdown: '' }
          : storedResult

        if (!sourceResult) {
          setStatus('empty')
          setStatusMessage('暂无待翻译内容')
          return
        }

        setArticle(sourceResult)

        if (sourceResult.translatedMarkdown.trim()) {
          setTranslatedMarkdown(sourceResult.translatedMarkdown)
          setStatus('complete')
          setStatusMessage('已恢复最近一次翻译结果')
          if (pending) {
            void removePendingTranslation().catch(() => undefined)
          }
          return
        }

        if (!sourceResult.originalMarkdown.trim()) {
          throw new Error('没有可翻译的 Markdown 原文')
        }

        setStatus('streaming')
        setStatusMessage('正在流式翻译…')

        const config = await loadUserConfig()
        const stream = translateMarkdownStream(sourceResult.originalMarkdown, config)
        const completedMarkdown = await playTypewriterStream(stream, setTranslatedMarkdown, {
          signal: controller.signal,
        })

        if (controller.signal.aborted) {
          return
        }

        if (!completedMarkdown.trim()) {
          throw new Error('翻译服务未返回内容')
        }

        const completedResult: TranslationResult = {
          ...sourceResult,
          translatedMarkdown: completedMarkdown,
          createdAt: Date.now(),
        }

        setArticle(completedResult)
        setStatus('complete')
        setStatusMessage('翻译完成')

        try {
          await persistLastResult(completedResult)
          if (shouldUsePending) {
            await removePendingTranslation()
          }
        } catch {
          setStatusMessage('翻译完成，但本地保存失败')
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatus('error')
          setStatusMessage(getTranslationErrorMessage(error))
        }
      }
    }

    void initializeResult()

    return () => controller.abort()
  }, [])

  useEffect(
    () => () => {
      if (copyResetTimer.current !== undefined) {
        window.clearTimeout(copyResetTimer.current)
      }
      if (downloadResetTimer.current !== undefined) {
        window.clearTimeout(downloadResetTimer.current)
      }
    },
    [],
  )

  const completeMarkdown = useMemo(
    () => (article ? formatTranslationMarkdown(article, translatedMarkdown) : ''),
    [article, translatedMarkdown],
  )

  const handleCopy = async () => {
    if (status !== 'complete' || !completeMarkdown) {
      return
    }

    setCopyStatus('copying')

    try {
      await copyTextToClipboard(completeMarkdown)
      setCopyStatus('success')
    } catch {
      setCopyStatus('error')
    }

    if (copyResetTimer.current !== undefined) {
      window.clearTimeout(copyResetTimer.current)
    }

    copyResetTimer.current = window.setTimeout(() => setCopyStatus('idle'), 1800)
  }

  const handleDownload = () => {
    if (status !== 'complete' || !article || !completeMarkdown) {
      return
    }

    try {
      downloadMarkdown(completeMarkdown, article.title)
      setDownloadStatus('success')
    } catch {
      setDownloadStatus('error')
    }

    if (downloadResetTimer.current !== undefined) {
      window.clearTimeout(downloadResetTimer.current)
    }

    downloadResetTimer.current = window.setTimeout(() => setDownloadStatus('idle'), 1800)
  }

  return (
    <div className="result">
      <header className="result__header">
        <button className="result__back" onClick={closeCurrentPage}>
          ← 返回
        </button>
        <span className="result__title">网页翻译结果</span>
        <div className="result__actions">
          <button
            className="btn btn--ghost"
            onClick={handleCopy}
            disabled={status !== 'complete' || !translatedMarkdown.trim() || copyStatus === 'copying'}
          >
            {getCopyButtonText(copyStatus)}
          </button>
          <button
            className="btn btn--ghost"
            onClick={handleDownload}
            disabled={status !== 'complete' || !translatedMarkdown.trim()}
          >
            {getDownloadButtonText(downloadStatus)}
          </button>
        </div>
      </header>

      <main className="result__body">
        <section className="result__meta">
          <h1 className="result__article-title">{article?.title || '文章标题'}</h1>
          <blockquote className="result__quote">
            <div>作者：{article?.author || '未知'}</div>
            <div>
              原文链接：
              {article?.sourceUrl ? (
                <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                  {article.sourceUrl}
                </a>
              ) : (
                '暂无'
              )}
            </div>
          </blockquote>
        </section>

        <div className={`result__status result__status--${status}`} role="status" aria-live="polite">
          {statusMessage}
        </div>

        <section className="result__content" aria-busy={status === 'loading' || status === 'streaming'}>
          {translatedMarkdown || status === 'streaming' ? (
            <div className="result__markdown-frame">
              <MarkdownRenderer
                className="result__markdown"
                markdown={translatedMarkdown}
                theme="minimal"
                defaultViewMode="desktop"
                followSystemTheme={false}
                showSettings={false}
                enableCopy={false}
                enableThemeSwitch={false}
                enableViewModeToggle={false}
              />
              {status === 'streaming' && (
                <span className="result__cursor" aria-hidden="true">
                  ▊
                </span>
              )}
            </div>
          ) : (
            <div className={`result__placeholder result__placeholder--${status}`}>
              {getPlaceholderText(status)}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function getDownloadButtonText(status: DownloadStatus): string {
  switch (status) {
    case 'success':
      return '已下载'
    case 'error':
      return '下载失败'
    default:
      return '下载'
  }
}

function getCopyButtonText(status: CopyStatus): string {
  switch (status) {
    case 'copying':
      return '复制中…'
    case 'success':
      return '已复制'
    case 'error':
      return '复制失败'
    default:
      return '复制'
  }
}

function getPlaceholderText(status: ResultStatus): string {
  switch (status) {
    case 'empty':
      return '请先从弹窗提取并提交一篇文章。'
    case 'error':
      return '无法显示翻译结果，请根据上方提示检查后重试。'
    default:
      return '正在准备翻译内容…'
  }
}
