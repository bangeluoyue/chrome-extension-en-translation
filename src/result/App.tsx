import { MarkdownRenderer } from 'md-wx'
import 'md-wx/dist/style.css'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './index.css'
import { assertModelEndpointPermission } from '../adapters/chromeAccess'
import { getArticleSizePreflight } from '../lib/articleSizePreflight'
import {
  createArticleTranslationRun,
  type ArticleTranslationProgress,
} from '../services/articleTranslation'
import {
  loadLastResult,
  loadPendingTranslation,
  loadTranslationProgress,
  loadUserConfig,
  persistCompletedTranslation,
  persistTranslationProgress,
  removePendingTranslation,
  removeTranslationProgress,
} from '../services/storageClient'
import {
  getTranslationErrorInfo,
  type TranslationErrorAction,
} from '../services/translation'
import {
  STORAGE_CAPACITY_ERROR_MESSAGE,
  type PendingTranslation,
  type TranslationProgress,
  type TranslationResult,
} from '../types'
import { copyTextToClipboard } from '../utils/clipboard'
import { downloadMarkdown } from '../utils/downloadMarkdown'
import { closeCurrentPage, openExtensionPage } from '../utils/navigation'
import {
  formatTranslationMarkdown,
  type TranslationMarkdownVariant,
} from '../utils/translationMarkdown'
import { playTypewriterStream } from '../utils/typewriter'

type ResultStatus = 'loading' | 'streaming' | 'complete' | 'cancelled' | 'empty' | 'error'
type CopyStatus = 'idle' | 'copying' | 'success' | 'error'
type DownloadStatus = 'idle' | 'success' | 'error'
type ReadingMode = 'translation' | 'bilingual' | 'original'

interface SegmentProgressState {
  currentSegment: number
  segmentCount: number
  completedSegmentCount: number
}

const READING_MODE_OPTIONS: ReadonlyArray<{ value: ReadingMode; label: string }> = [
  { value: 'translation', label: '仅译文' },
  { value: 'bilingual', label: '双语对照' },
  { value: 'original', label: '仅原文' },
]
const READING_MODE_STORAGE_KEY = 'readingMode'
const COUNT_FORMATTER = new Intl.NumberFormat('zh-CN')
const EMPTY_SEGMENT_PROGRESS: SegmentProgressState = {
  currentSegment: 0,
  segmentCount: 0,
  completedSegmentCount: 0,
}

interface AppProps {
  surface?: 'page' | 'sidepanel'
  headerAction?: ReactNode
  topContent?: ReactNode
  savedResult?: TranslationResult | null
  onResultChange?: (result: TranslationResult | null) => void
}

export default function App({
  surface = 'page',
  headerAction,
  topContent,
  savedResult,
  onResultChange,
}: AppProps) {
  const [article, setArticle] = useState<TranslationResult | null>(null)
  const [translatedMarkdown, setTranslatedMarkdown] = useState('')
  const [status, setStatus] = useState<ResultStatus>('loading')
  const [statusMessage, setStatusMessage] = useState('正在读取文章…')
  const [errorAction, setErrorAction] = useState<TranslationErrorAction | null>(null)
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle')
  const [copyVariant, setCopyVariant] =
    useState<TranslationMarkdownVariant>('translation')
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle')
  const [readingMode, setReadingMode] = useState<ReadingMode>('translation')
  const [segmentProgress, setSegmentProgress] =
    useState<SegmentProgressState>(EMPTY_SEGMENT_PROGRESS)
  const [pendingVersion, setPendingVersion] = useState(0)
  const [translationVersion, setTranslationVersion] = useState(0)
  const copyResetTimer = useRef<number>()
  const downloadResetTimer = useRef<number>()
  const translationController = useRef<AbortController | null>(null)
  const forceRetranslate = useRef(false)

  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.pendingTranslation?.newValue) {
        setPendingVersion((current) => current + 1)
      }

      const nextReadingMode = changes[READING_MODE_STORAGE_KEY]?.newValue
      if (areaName === 'local' && isReadingMode(nextReadingMode)) {
        setReadingMode(nextReadingMode)
      }
    }

    let active = true
    chrome.storage.local
      .get(READING_MODE_STORAGE_KEY)
      .then((data) => {
        const savedReadingMode = data[READING_MODE_STORAGE_KEY]
        if (active && isReadingMode(savedReadingMode)) {
          setReadingMode(savedReadingMode)
        }
      })
      .catch(() => undefined)

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const shouldRetranslate = forceRetranslate.current
    let activeSegmentProgress = EMPTY_SEGMENT_PROGRESS
    forceRetranslate.current = false
    translationController.current = controller

    const initializeResult = async () => {
      try {
        setErrorAction(null)
        setCopyStatus('idle')
        setCopyMenuOpen(false)
        setStatus('loading')
        setSegmentProgress(EMPTY_SEGMENT_PROGRESS)
        setStatusMessage(shouldRetranslate ? '正在准备重新翻译…' : '正在读取文章…')

        const usesSavedResult = savedResult !== undefined
        const resultSources: [TranslationResult | null, PendingTranslation | null] =
          usesSavedResult
            ? [savedResult ?? null, null]
            : await Promise.all([loadLastResult(), loadPendingTranslation()])
        const [storedResult, pending] = resultSources

        if (controller.signal.aborted) {
          return
        }

        const shouldUsePending =
          pending !== null && (!storedResult || pending.createdAt >= storedResult.createdAt)
        const sourceResult: TranslationResult | null = shouldUsePending
          ? { ...pending, translatedMarkdown: '' }
          : storedResult

        if (!sourceResult) {
          setArticle(null)
          setTranslatedMarkdown('')
          setStatus('empty')
          setStatusMessage('暂无待翻译内容')
          onResultChange?.(null)
          void removeTranslationProgress().catch(() => undefined)
          return
        }

        setArticle(sourceResult)
        onResultChange?.(sourceResult)

        if (sourceResult.translatedMarkdown.trim() && !shouldRetranslate) {
          setTranslatedMarkdown(sourceResult.translatedMarkdown)
          setStatus('complete')
          setStatusMessage(usesSavedResult ? '已打开历史翻译' : '已恢复最近一次翻译结果')
          void Promise.all([
            pending ? removePendingTranslation() : Promise.resolve(),
            removeTranslationProgress(),
          ]).catch(() => undefined)
          return
        }

        if (!sourceResult.originalMarkdown.trim()) {
          throw new Error('没有可翻译的 Markdown 原文')
        }

        setTranslatedMarkdown('')
        setStatus('loading')
        setStatusMessage('正在检查模型配置…')

        const [config, storedProgress] = await Promise.all([
          loadUserConfig(),
          shouldRetranslate
            ? Promise.resolve(null)
            : loadTranslationProgress(),
        ])

        if (controller.signal.aborted) {
          return
        }

        await assertModelEndpointPermission(config.baseUrl)

        if (controller.signal.aborted) {
          return
        }

        const resumableProgress = isProgressForArticle(storedProgress, sourceResult)
          ? storedProgress
          : null

        if (storedProgress && !resumableProgress) {
          await removeTranslationProgress()
        }

        const handleProgress = async (progress: ArticleTranslationProgress) => {
          if (controller.signal.aborted) {
            return
          }

          const nextProgress = toSegmentProgressState(progress)

          if (progress.phase === 'completed') {
            await persistTranslationProgress({
              sourceUrl: sourceResult.sourceUrl,
              articleCreatedAt: sourceResult.createdAt,
              segmentCount: progress.segmentCount,
              completedSegments: [...progress.completedSegments],
              updatedAt: Date.now(),
            })
          }

          if (controller.signal.aborted) {
            return
          }

          activeSegmentProgress = nextProgress
          setSegmentProgress(nextProgress)

          if (progress.phase === 'translating') {
            setStatusMessage(getStreamingStatusMessage(nextProgress))
          }
        }

        const run = createArticleTranslationRun(sourceResult.originalMarkdown, config, {
          signal: controller.signal,
          resume: resumableProgress
            ? {
                segmentCount: resumableProgress.segmentCount,
                completedSegments: resumableProgress.completedSegments,
              }
            : null,
          onProgress: handleProgress,
        })

        if (resumableProgress && !run.resumeAccepted) {
          await removeTranslationProgress()
        }

        activeSegmentProgress = {
          currentSegment:
            run.completedSegmentCount < run.segmentCount
              ? run.completedSegmentCount + 1
              : run.segmentCount,
          segmentCount: run.segmentCount,
          completedSegmentCount: run.completedSegmentCount,
        }
        setSegmentProgress(activeSegmentProgress)
        setTranslatedMarkdown(run.initialMarkdown)

        setStatus('streaming')
        setStatusMessage(
          run.completedSegmentCount === run.segmentCount
            ? '正在恢复已完成译文…'
            : getStreamingStatusMessage(activeSegmentProgress),
        )
        const completedMarkdown = await playTypewriterStream(run.stream, setTranslatedMarkdown, {
          signal: controller.signal,
          initialText: run.initialMarkdown,
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
        onResultChange?.(completedResult)
        setStatus('complete')
        setStatusMessage('翻译完成')

        let completionMessage = '翻译完成'

        try {
          const saveResult = await persistCompletedTranslation(completedResult)
          if (saveResult.removedHistoryCount > 0) {
            completionMessage = `翻译完成，已自动清理 ${saveResult.removedHistoryCount} 条较早历史记录以释放空间`
          }
        } catch (error) {
          completionMessage = getCompletedSaveFailureMessage(error)
        }

        setStatusMessage(completionMessage)
      } catch (error) {
        if (!controller.signal.aborted) {
          const errorInfo = getTranslationErrorInfo(error)
          setStatus('error')
          setStatusMessage(
            getFailedStatusMessage(errorInfo.message, activeSegmentProgress),
          )
          setErrorAction(errorInfo.action)
        }
      }
    }

    void initializeResult()

    return () => {
      controller.abort()
      if (translationController.current === controller) {
        translationController.current = null
      }
    }
  }, [onResultChange, pendingVersion, savedResult, translationVersion])

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

  const downloadMarkdownContent = useMemo(
    () =>
      article
        ? formatTranslationMarkdown(article, translatedMarkdown, 'bilingual')
        : '',
    [article, translatedMarkdown],
  )
  const articleSize = useMemo(
    () => (article ? getArticleSizePreflight(article.originalMarkdown) : null),
    [article],
  )

  const handleCopy = async (variant: TranslationMarkdownVariant) => {
    if (status !== 'complete' || !article || !translatedMarkdown.trim()) {
      return
    }

    setCopyVariant(variant)
    setCopyMenuOpen(false)
    setCopyStatus('copying')

    try {
      await copyTextToClipboard(
        formatTranslationMarkdown(article, translatedMarkdown, variant),
      )
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
    if (status !== 'complete' || !article || !downloadMarkdownContent) {
      return
    }

    try {
      downloadMarkdown(downloadMarkdownContent, article.title)
      setDownloadStatus('success')
    } catch {
      setDownloadStatus('error')
    }

    if (downloadResetTimer.current !== undefined) {
      window.clearTimeout(downloadResetTimer.current)
    }

    downloadResetTimer.current = window.setTimeout(() => setDownloadStatus('idle'), 1800)
  }

  const handleReadingModeChange = (mode: ReadingMode) => {
    setReadingMode(mode)
    void chrome.storage.local.set({ [READING_MODE_STORAGE_KEY]: mode }).catch(() => undefined)
  }

  const handleCancelTranslation = () => {
    if (status !== 'streaming') {
      return
    }

    translationController.current?.abort()
    setErrorAction(null)
    setStatus('cancelled')
    setStatusMessage(getCancelledStatusMessage(segmentProgress))
  }

  const handleContinueTranslation = () => {
    if (!article || status === 'loading' || status === 'streaming') {
      return
    }

    setCopyStatus('idle')
    setCopyMenuOpen(false)
    setDownloadStatus('idle')
    setErrorAction(null)
    setStatus('loading')
    setStatusMessage('正在准备继续翻译…')
    setTranslationVersion((current) => current + 1)
  }

  const handleRetranslate = async () => {
    if (!article || status === 'loading' || status === 'streaming') {
      return
    }

    setCopyStatus('idle')
    setCopyMenuOpen(false)
    setDownloadStatus('idle')
    setErrorAction(null)
    setStatus('loading')
    setStatusMessage('正在清除旧进度…')

    try {
      await removeTranslationProgress()
      forceRetranslate.current = true
      setSegmentProgress(EMPTY_SEGMENT_PROGRESS)
      setTranslatedMarkdown('')
      setStatusMessage('正在准备重新翻译…')
      setTranslationVersion((current) => current + 1)
    } catch {
      setStatus('error')
      setStatusMessage('无法清除旧翻译进度，请重试')
      setErrorAction('retry')
    }
  }

  return (
    <div className={`result result--${surface}`}>
      <header className="result__header">
        {surface === 'page' && (
          <button className="result__back" type="button" onClick={closeCurrentPage}>
            ← 关闭
          </button>
        )}
        <span className="result__title">文章阅读助手</span>
        <div className="result__actions">
          {headerAction}
          {article?.sourceUrl && (
            <a
              className="btn btn--ghost result__source-link"
              href={article.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              ↗ 原文
            </a>
          )}
          {surface === 'sidepanel' && (
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => openExtensionPage('settings')}
            >
              设置
            </button>
          )}
          <div className="result__copy-control">
            <button
              className="btn btn--ghost"
              type="button"
              aria-expanded={copyMenuOpen}
              aria-haspopup="menu"
              aria-controls="result-copy-menu"
              aria-live="polite"
              onClick={() => setCopyMenuOpen((open) => !open)}
              disabled={
                status !== 'complete' ||
                !translatedMarkdown.trim() ||
                copyStatus === 'copying'
              }
            >
              {getCopyButtonText(copyStatus, copyVariant)}
            </button>
            {copyMenuOpen && (
              <div className="result__copy-menu" id="result-copy-menu" role="menu">
                <button
                  className="result__copy-option"
                  type="button"
                  role="menuitem"
                  onClick={() => void handleCopy('translation')}
                >
                  仅译文 Markdown
                </button>
                <button
                  className="result__copy-option"
                  type="button"
                  role="menuitem"
                  onClick={() => void handleCopy('bilingual')}
                >
                  双语 Markdown
                </button>
              </div>
            )}
          </div>
          <button
            className="btn btn--ghost"
            type="button"
            onClick={handleDownload}
            disabled={status !== 'complete' || !translatedMarkdown.trim()}
          >
            {getDownloadButtonText(downloadStatus)}
          </button>
        </div>
      </header>

      <main className="result__body">
        {topContent}

        {article && (
          <section className="result__meta">
            <h1 className="result__article-title">{article.title || '未命名文章'}</h1>
            <blockquote className="result__quote">
              <div>作者：{article.author || '未知'}</div>
              <div>
                原文链接：
                {article.sourceUrl ? (
                  <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                    {article.sourceUrl}
                  </a>
                ) : (
                  '暂无'
                )}
              </div>
            </blockquote>
          </section>
        )}

        {articleSize && (
          <aside
            className={`result__preflight ${
              articleSize.isLongArticle ? 'result__preflight--warning' : ''
            }`}
            aria-label="文章规模预检"
          >
            <div className="result__preflight-summary">
              {formatCount(articleSize.characterCount)} 个字符 ·{' '}
              {articleSize.isLongArticle ? '长文章' : '普通文章'} ·{' '}
              {formatCount(articleSize.markdownBlockCount)} 个 Markdown 块
            </div>
            {articleSize.isLongArticle && (
              <div className="result__preflight-warning">
                文章较长，将按 Markdown 结构顺序分段翻译。
              </div>
            )}
          </aside>
        )}

        <div className="result__status-row">
          <div
            className={`result__status result__status--${status}`}
            role="status"
            aria-live="polite"
          >
            {statusMessage}
          </div>
          <div className="result__translation-controls">
            {status === 'error' && errorAction === 'settings' && (
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => openExtensionPage('settings')}
              >
                检查设置
              </button>
            )}
            {status === 'streaming' && (
              <button className="btn btn--ghost" type="button" onClick={handleCancelTranslation}>
                取消
              </button>
            )}
            {article && (status === 'cancelled' || status === 'error') && (
              <button className="btn btn--ghost" type="button" onClick={handleContinueTranslation}>
                {hasCompletedSegments(segmentProgress) ? '继续翻译' : '重试'}
              </button>
            )}
            {article &&
              (status === 'complete' ||
                ((status === 'cancelled' || status === 'error') &&
                  hasCompletedSegments(segmentProgress))) && (
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => void handleRetranslate()}
                >
                  重新翻译
                </button>
              )}
          </div>
        </div>

        {article && <ReadingModeSwitch value={readingMode} onChange={handleReadingModeChange} />}

        <section
          className="result__content"
          aria-busy={
            readingMode !== 'original' && (status === 'loading' || status === 'streaming')
          }
        >
          {article ? (
            <>
              {(readingMode === 'original' || readingMode === 'bilingual') && (
                <ReadingSection
                  label={readingMode === 'bilingual' ? '原文' : undefined}
                  markdown={article.originalMarkdown}
                  status={status}
                />
              )}

              {(readingMode === 'translation' || readingMode === 'bilingual') && (
                <ReadingSection
                  label={readingMode === 'bilingual' ? '译文' : undefined}
                  markdown={translatedMarkdown}
                  status={status}
                  streaming={status === 'streaming'}
                />
              )}
            </>
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

function isReadingMode(value: unknown): value is ReadingMode {
  return value === 'translation' || value === 'bilingual' || value === 'original'
}

function isProgressForArticle(
  progress: TranslationProgress | null,
  article: TranslationResult,
): progress is TranslationProgress {
  return Boolean(
    progress &&
      progress.sourceUrl === article.sourceUrl &&
      progress.articleCreatedAt === article.createdAt,
  )
}

function toSegmentProgressState(
  progress: ArticleTranslationProgress,
): SegmentProgressState {
  return {
    currentSegment: progress.currentSegment,
    segmentCount: progress.segmentCount,
    completedSegmentCount: progress.completedSegmentCount,
  }
}

function getStreamingStatusMessage(progress: SegmentProgressState): string {
  if (progress.segmentCount <= 1) {
    return '正在翻译，译文将持续显示…'
  }

  return `正在翻译第 ${progress.currentSegment}/${progress.segmentCount} 段，译文将持续显示…`
}

function getCancelledStatusMessage(progress: SegmentProgressState): string {
  if (progress.completedSegmentCount === 0 && progress.segmentCount <= 1) {
    return '翻译已取消，可重新翻译当前文章'
  }

  return `翻译已取消，已完成 ${progress.completedSegmentCount}/${progress.segmentCount} 段，可继续翻译`
}

function getFailedStatusMessage(
  errorMessage: string,
  progress: SegmentProgressState,
): string {
  if (progress.segmentCount <= 1 || progress.currentSegment === 0) {
    return errorMessage
  }

  return `第 ${progress.currentSegment}/${progress.segmentCount} 段翻译失败，已完成 ${progress.completedSegmentCount}/${progress.segmentCount} 段。${errorMessage}`
}

function getCompletedSaveFailureMessage(error: unknown): string {
  if (
    error instanceof Error &&
    error.message.includes(STORAGE_CAPACITY_ERROR_MESSAGE)
  ) {
    return '译文已生成但未保存：本地存储空间不足。请先复制或下载当前译文，再删除较早历史或清理扩展本地数据。'
  }

  return '翻译完成，但本地保存失败；当前译文仍可复制或下载'
}

function hasCompletedSegments(progress: SegmentProgressState): boolean {
  return progress.completedSegmentCount > 0
}

function formatCount(value: number): string {
  return COUNT_FORMATTER.format(value)
}

interface ReadingModeSwitchProps {
  value: ReadingMode
  onChange: (mode: ReadingMode) => void
}

function ReadingModeSwitch({ value, onChange }: ReadingModeSwitchProps) {
  return (
    <div className="result__mode-switch" role="group" aria-label="阅读模式">
      {READING_MODE_OPTIONS.map((option) => (
        <button
          className={`result__mode-button ${value === option.value ? 'result__mode-button--active' : ''}`}
          type="button"
          aria-pressed={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface ReadingSectionProps {
  label?: string
  markdown: string
  status: ResultStatus
  streaming?: boolean
}

function ReadingSection({ label, markdown, status, streaming = false }: ReadingSectionProps) {
  return (
    <section className="result__reading-section">
      {label && <h2 className="result__reading-label">{label}</h2>}
      {markdown || streaming ? (
        <div className="result__markdown-frame">
          <MarkdownRenderer
            className="result__markdown"
            markdown={markdown}
            theme="minimal"
            defaultViewMode="desktop"
            followSystemTheme={false}
            showSettings={false}
            enableCopy={false}
            enableThemeSwitch={false}
            enableViewModeToggle={false}
          />
          {streaming && (
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

function getCopyButtonText(
  status: CopyStatus,
  variant: TranslationMarkdownVariant,
): string {
  switch (status) {
    case 'copying':
      return '复制中…'
    case 'success':
      return variant === 'translation' ? '已复制译文' : '已复制双语'
    case 'error':
      return '复制失败'
    default:
      return '复制 ▾'
  }
}

function getPlaceholderText(status: ResultStatus): string {
  switch (status) {
    case 'loading':
      return '正在准备文章内容，请稍候…'
    case 'empty':
      return '暂无文章。请回到英文文章页，点击扩展图标发起翻译。'
    case 'error':
      return '翻译没有完成，请根据上方提示处理后重试。'
    case 'cancelled':
      return '翻译已取消，请使用上方操作继续。'
    default:
      return '正在准备翻译内容…'
  }
}
