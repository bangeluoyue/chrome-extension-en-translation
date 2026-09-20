import { useCallback, useEffect, useState } from 'react'
import ResultApp from '../result/App'
import { assertModelEndpointPermission } from '../adapters/chromeAccess'
import {
  loadPendingSelection,
  loadTranslationHistory,
  loadUserConfig,
  removePendingSelection,
  removeTranslationHistoryEntry,
} from '../services/storageClient'
import { getTranslationErrorInfo, translateSelectionText } from '../services/translation'
import type { PendingSelection, TranslationHistoryEntry, TranslationResult } from '../types'
import { copyTextToClipboard } from '../utils/clipboard'
import './index.css'

const PENDING_SELECTION_KEY = 'pendingSelection'
const PENDING_TRANSLATION_KEY = 'pendingTranslation'
const TRANSLATION_HISTORY_KEY = 'translationHistory'

type SidePanelView = 'reader' | 'history'

export default function App() {
  const [selection, setSelection] = useState<PendingSelection | null>(null)
  const [history, setHistory] = useState<TranslationHistoryEntry[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [savedResult, setSavedResult] = useState<TranslationResult | null | undefined>()
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [view, setView] = useState<SidePanelView>('reader')

  useEffect(() => {
    let active = true
    let selectionChanged = false
    let historyChanged = false

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') {
        return
      }

      if (PENDING_SELECTION_KEY in changes) {
        selectionChanged = true
        const nextSelection = changes[PENDING_SELECTION_KEY]?.newValue
        const validSelection = isPendingSelection(nextSelection) ? nextSelection : null
        setSelection(validSelection)
        if (validSelection) {
          setView('reader')
        }
      }

      if (
        PENDING_TRANSLATION_KEY in changes &&
        changes[PENDING_TRANSLATION_KEY]?.newValue
      ) {
        setSavedResult(undefined)
        setActiveHistoryId(null)
        setView('reader')
      }

      if (TRANSLATION_HISTORY_KEY in changes) {
        historyChanged = true
        void loadTranslationHistory()
          .then((storedHistory) => {
            if (active) {
              setHistory(normalizeTranslationHistory(storedHistory))
              setHistoryLoaded(true)
            }
          })
          .catch(() => {
            if (active) {
              setHistoryLoaded(true)
            }
          })
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    loadPendingSelection()
      .then((pendingSelection) => {
        if (active && !selectionChanged) {
          setSelection(pendingSelection)
        }
      })
      .catch(() => undefined)
    loadTranslationHistory()
      .then((storedHistory) => {
        if (active && !historyChanged) {
          setHistory(normalizeTranslationHistory(storedHistory))
          setHistoryLoaded(true)
        }
      })
      .catch(() => {
        if (active && !historyChanged) {
          setHistoryLoaded(true)
        }
      })

    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  const handleCloseSelection = () => {
    setSelection(null)
    void removePendingSelection().catch(() => undefined)
  }

  const handleResultChange = useCallback((result: TranslationResult | null) => {
    setActiveHistoryId(result ? getTranslationResultId(result) : null)
  }, [])

  const handleOpenHistory = (entry: TranslationHistoryEntry) => {
    setSavedResult(toTranslationResult(entry))
    setActiveHistoryId(entry.id)
    setHistoryError('')
    setView('reader')
  }

  const handleDeleteHistory = async (id: string) => {
    const shouldReplaceReader =
      activeHistoryId === id || (savedResult === undefined && history[0]?.id === id)

    setDeletingHistoryId(id)
    setHistoryError('')

    try {
      const nextHistory = normalizeTranslationHistory(
        await removeTranslationHistoryEntry(id),
      )
      setHistory(nextHistory)
      if (shouldReplaceReader) {
        setSavedResult(nextHistory[0] ? toTranslationResult(nextHistory[0]) : null)
        setActiveHistoryId(nextHistory[0]?.id ?? null)
      }
    } catch {
      setHistoryError('删除失败，请重试')
    } finally {
      setDeletingHistoryId(null)
    }
  }

  return (
    <div className="sidepanel-shell">
      <div className="sidepanel-reader" hidden={view !== 'reader'}>
        <ResultApp
          surface="sidepanel"
          savedResult={savedResult}
          onResultChange={handleResultChange}
          headerAction={
            <button className="btn btn--ghost" type="button" onClick={() => setView('history')}>
              历史
            </button>
          }
          topContent={
            selection && (
              <SelectionCard
                key={`${selection.sourceUrl}:${selection.sourceText}`}
                selection={selection}
                onClose={handleCloseSelection}
              />
            )
          }
        />
      </div>
      {view === 'history' && (
        <HistoryView
          history={history}
          loaded={historyLoaded}
          deletingId={deletingHistoryId}
          error={historyError}
          onBack={() => setView('reader')}
          onDelete={handleDeleteHistory}
          onOpen={handleOpenHistory}
        />
      )}
    </div>
  )
}

interface HistoryViewProps {
  history: TranslationHistoryEntry[]
  loaded: boolean
  deletingId: string | null
  error: string
  onBack: () => void
  onDelete: (id: string) => Promise<void>
  onOpen: (entry: TranslationHistoryEntry) => void
}

function HistoryView({
  history,
  loaded,
  deletingId,
  error,
  onBack,
  onDelete,
  onOpen,
}: HistoryViewProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const handleDelete = (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }

    setConfirmDeleteId(null)
    void onDelete(id)
  }

  return (
    <section className="history-view" aria-labelledby="history-view-title">
      <header className="history-view__header">
        <button className="history-view__back" type="button" onClick={onBack}>
          ← 返回阅读
        </button>
        <h1 className="history-view__title" id="history-view-title">
          最近阅读（{history.length}）
        </h1>
      </header>
      <div className="history-view__body">
        {error && (
          <div className="history-view__error" role="status">
            {error}
          </div>
        )}
        {!loaded ? (
          <div className="history-view__empty">正在读取历史…</div>
        ) : history.length === 0 ? (
          <div className="history-view__empty">暂无翻译历史</div>
        ) : (
          <div className="history-list">
            {history.map((entry) => (
              <article className="history-list__item" key={entry.id}>
                <button
                  className="history-list__open"
                  type="button"
                  onClick={() => onOpen(entry)}
                >
                  <span className="history-list__title">{entry.title || '未命名文章'}</span>
                  <span className="history-list__meta">
                    {getSiteLabel(entry.sourceUrl)} · {formatHistoryTime(entry.createdAt)}
                  </span>
                </button>
                <button
                  className={`history-list__delete ${confirmDeleteId === entry.id ? 'history-list__delete--confirm' : ''}`}
                  type="button"
                  disabled={deletingId === entry.id}
                  aria-label={`删除 ${entry.title || '未命名文章'}`}
                  onClick={() => handleDelete(entry.id)}
                >
                  {deletingId === entry.id
                    ? '删除中…'
                    : confirmDeleteId === entry.id
                      ? '确认删除'
                      : '删除'}
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

interface SelectionCardProps {
  selection: PendingSelection
  onClose: () => void
}

type SelectionTranslationStatus = 'translating' | 'success' | 'error'
type SelectionCopyStatus = 'idle' | 'copying' | 'success' | 'error'

function SelectionCard({ selection, onClose }: SelectionCardProps) {
  const [translationStatus, setTranslationStatus] =
    useState<SelectionTranslationStatus>('translating')
  const [translatedText, setTranslatedText] = useState('')
  const [translationMessage, setTranslationMessage] = useState('正在翻译…')
  const [copyStatus, setCopyStatus] = useState<SelectionCopyStatus>('idle')

  useEffect(() => {
    const controller = new AbortController()

    const translateSelection = async () => {
      setTranslationStatus('translating')
      setTranslatedText('')
      setTranslationMessage('正在翻译…')
      setCopyStatus('idle')

      try {
        const config = await loadUserConfig()

        if (controller.signal.aborted) {
          return
        }

        await assertModelEndpointPermission(config.baseUrl)

        if (controller.signal.aborted) {
          return
        }

        const translation = await translateSelectionText(
          selection.sourceText,
          config,
          controller.signal,
        )

        if (!controller.signal.aborted) {
          setTranslatedText(translation)
          setTranslationStatus('success')
          setTranslationMessage('翻译完成')
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setTranslationStatus('error')
          setTranslationMessage(getTranslationErrorInfo(error).message)
        }
      }
    }

    void translateSelection()
    return () => controller.abort()
  }, [selection])

  const handleCopy = async () => {
    if (translationStatus !== 'success' || !translatedText) {
      return
    }

    setCopyStatus('copying')

    try {
      await copyTextToClipboard(translatedText)
      setCopyStatus('success')
    } catch {
      setCopyStatus('error')
    }
  }

  return (
    <section className="selection-card" aria-labelledby="selection-card-title">
      <header className="selection-card__header">
        <h2 className="selection-card__title" id="selection-card-title">
          划词翻译
        </h2>
        <button
          className="selection-card__close"
          type="button"
          aria-label="关闭划词翻译卡片"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="selection-card__label">原文</div>
      <p className="selection-card__text">{selection.sourceText}</p>
      <footer className="selection-card__source">
        <span title={selection.pageTitle}>{selection.pageTitle || '当前页面'}</span>
        {selection.sourceUrl && (
          <a href={selection.sourceUrl} target="_blank" rel="noreferrer">
            打开原页面
          </a>
        )}
      </footer>
      <div className="selection-card__translation">
        <div className="selection-card__label">译文</div>
        {translationStatus === 'success' ? (
          <p className="selection-card__translation-text">{translatedText}</p>
        ) : (
          <p
            className={`selection-card__translation-status selection-card__translation-status--${translationStatus}`}
            role="status"
            aria-live="polite"
          >
            {translationMessage}
          </p>
        )}
      </div>
      {translationStatus === 'success' && (
        <div className="selection-card__actions">
          <button
            className="btn btn--ghost"
            type="button"
            onClick={handleCopy}
            disabled={copyStatus === 'copying'}
          >
            {getCopyButtonText(copyStatus)}
          </button>
        </div>
      )}
    </section>
  )
}

function getCopyButtonText(status: SelectionCopyStatus): string {
  switch (status) {
    case 'copying':
      return '复制中…'
    case 'success':
      return '已复制'
    case 'error':
      return '复制失败'
    default:
      return '复制译文'
  }
}

function isPendingSelection(value: unknown): value is PendingSelection {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const selection = value as Record<string, unknown>
  return (
    typeof selection.sourceText === 'string' &&
    typeof selection.pageTitle === 'string' &&
    typeof selection.sourceUrl === 'string'
  )
}

function normalizeTranslationHistory(value: unknown): TranslationHistoryEntry[] {
  return Array.isArray(value) ? value.filter(isTranslationHistoryEntry) : []
}

function getTranslationResultId(result: TranslationResult): string {
  return `${result.sourceUrl}:${result.createdAt}`
}

function toTranslationResult(entry: TranslationHistoryEntry): TranslationResult {
  return {
    title: entry.title,
    author: entry.author,
    sourceUrl: entry.sourceUrl,
    originalMarkdown: entry.originalMarkdown,
    translatedMarkdown: entry.translatedMarkdown,
    createdAt: entry.createdAt,
  }
}

function isTranslationHistoryEntry(value: unknown): value is TranslationHistoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.author === 'string' &&
    typeof entry.sourceUrl === 'string' &&
    typeof entry.originalMarkdown === 'string' &&
    typeof entry.translatedMarkdown === 'string' &&
    typeof entry.createdAt === 'number'
  )
}

function getSiteLabel(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '') || '未知来源'
  } catch {
    return '未知来源'
  }
}

function formatHistoryTime(createdAt: number, now = Date.now()): string {
  const date = new Date(createdAt)

  if (Number.isNaN(date.getTime())) {
    return '时间未知'
  }

  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)

  if (isSameCalendarDay(date, today)) {
    return `今天 ${time}`
  }

  if (isSameCalendarDay(date, yesterday)) {
    return `昨天 ${time}`
  }

  const day = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return `${day} ${time}`
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}
