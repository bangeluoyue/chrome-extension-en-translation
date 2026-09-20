import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_CAPACITY_ERROR_MESSAGE,
  type PendingTranslation,
  type TranslationProgress,
  type TranslationResult,
} from '../types'
import {
  clearTranslationProgress,
  clearUserApiKey,
  deleteTranslationFromHistory,
  getLastResult,
  getTranslationHistory,
  getTranslationProgress,
  getUserConfig,
  saveCompletedTranslation,
  savePendingTranslation,
  saveTranslationProgress,
  saveUserConfig,
} from './storage'

beforeEach(() => {
  const storageLocal = chrome.storage.local as unknown as { QUOTA_BYTES: number }
  storageLocal.QUOTA_BYTES = 10 * 1024 * 1024
})

describe('user configuration storage', () => {
  it('rejects an insecure non-local endpoint before saving', async () => {
    await expect(
      saveUserConfig({
        apiKey: 'secret',
        model: 'test-model',
        baseUrl: 'http://api.example.com/v1',
      }),
    ).rejects.toThrow('Base URL 必须使用 HTTPS')
    await expect(chrome.storage.local.get('userConfig')).resolves.toEqual({})
  })

  it('allows local HTTP and removes only the saved API key', async () => {
    await saveUserConfig({
      apiKey: 'secret',
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:3000/v1/',
    })

    await clearUserApiKey()

    await expect(chrome.storage.local.get('userConfig')).resolves.toEqual({
      userConfig: {
        model: 'test-model',
        baseUrl: 'http://127.0.0.1:3000/v1',
      },
    })
    await expect(getUserConfig()).resolves.toEqual({
      apiKey: '',
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:3000/v1',
    })
  })
})

describe('translation result storage', () => {
  it('stores each full result once and keeps only metadata in recent references', async () => {
    const first = createResult(1)
    const second = createResult(2)

    await saveCompletedTranslation(first)
    await saveCompletedTranslation(second)
    await saveCompletedTranslation(second)

    const stored = await chrome.storage.local.get([
      'storageVersion',
      'translationResults',
      'lastResult',
      'translationHistory',
    ])
    const secondId = getResultId(second)

    expect(stored.storageVersion).toBe(1)
    expect(stored.lastResult).toBe(secondId)
    expect(stored.translationResults).toEqual({
      [getResultId(first)]: first,
      [secondId]: second,
    })
    expect(stored.translationHistory).toEqual([
      toMetadata(second),
      toMetadata(first),
    ])
    expect(JSON.stringify(stored.translationHistory)).not.toContain('originalMarkdown')
    await expect(getLastResult()).resolves.toEqual(second)
    await expect(getTranslationHistory()).resolves.toEqual([
      { ...second, id: secondId },
      { ...first, id: getResultId(first) },
    ])
  })

  it('migrates legacy full results once without losing content', async () => {
    const first = createResult(1)
    const second = createResult(2)
    await chrome.storage.local.set({
      lastResult: second,
      translationHistory: [
        { ...second, id: getResultId(second) },
        { ...first, id: getResultId(first) },
      ],
    })

    await expect(getLastResult()).resolves.toEqual(second)
    await expect(getTranslationHistory()).resolves.toEqual([
      { ...second, id: getResultId(second) },
      { ...first, id: getResultId(first) },
    ])
    const firstMigration = await chrome.storage.local.get(null)

    await expect(getTranslationHistory()).resolves.toHaveLength(2)
    await expect(chrome.storage.local.get(null)).resolves.toEqual(firstMigration)
    expect(firstMigration).toMatchObject({
      storageVersion: 1,
      lastResult: getResultId(second),
      translationResults: {
        [getResultId(first)]: first,
        [getResultId(second)]: second,
      },
      translationHistory: [toMetadata(second), toMetadata(first)],
    })
  })

  it('keeps only the latest 20 translations and removes unreferenced bodies', async () => {
    for (let index = 1; index <= 21; index += 1) {
      await saveCompletedTranslation(createResult(index))
    }

    const history = await getTranslationHistory()
    const stored = await chrome.storage.local.get('translationResults')

    expect(history).toHaveLength(20)
    expect(history[0].createdAt).toBe(21)
    expect(history[19].createdAt).toBe(2)
    expect(Object.keys(stored.translationResults as object)).toHaveLength(20)
    expect(stored.translationResults).not.toHaveProperty(getResultId(createResult(1)))
  })

  it('replaces a deleted latest result and removes its single body record', async () => {
    const first = createResult(1)
    const second = createResult(2)
    await saveCompletedTranslation(first)
    await saveCompletedTranslation(second)

    const remaining = await deleteTranslationFromHistory(getResultId(second))
    const stored = await chrome.storage.local.get(['lastResult', 'translationResults'])

    expect(remaining.map((entry) => entry.title)).toEqual(['Article 1'])
    expect(await getLastResult()).toEqual(first)
    expect(stored.lastResult).toBe(getResultId(first))
    expect(stored.translationResults).toEqual({ [getResultId(first)]: first })
  })
})

describe('storage capacity handling', () => {
  it('checks capacity before and after writes and removes the oldest history first', async () => {
    const first = createResult(1)
    const second = createResult(2)
    const third = createResult(3)
    await saveCompletedTranslation(first)
    await saveCompletedTranslation(second)
    vi.mocked(chrome.storage.local.getBytesInUse).mockClear()
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
      new Error('QUOTA_BYTES quota exceeded'),
    )

    const outcome = await saveCompletedTranslation(third)

    expect(outcome).toEqual({ removedHistoryCount: 1 })
    expect((await getTranslationHistory()).map((entry) => entry.title)).toEqual([
      'Article 3',
      'Article 2',
    ])
    expect(chrome.storage.local.getBytesInUse).toHaveBeenCalledWith(null)
    expect(chrome.storage.local.getBytesInUse).toHaveBeenCalledWith(
      expect.arrayContaining(['translationResults', 'translationHistory']),
    )
  })

  it('keeps the previous recent result when even the new result alone cannot be saved', async () => {
    const previous = createResult(1)
    const oversized = {
      ...createResult(2),
      originalMarkdown: 'source'.repeat(100),
      translatedMarkdown: 'translation'.repeat(100),
    }
    await saveCompletedTranslation(previous)
    vi.mocked(chrome.storage.local.set).mockRejectedValue(
      new Error('QUOTA_BYTES quota exceeded'),
    )

    await expect(saveCompletedTranslation(oversized)).rejects.toThrow(
      STORAGE_CAPACITY_ERROR_MESSAGE,
    )
    await expect(getLastResult()).resolves.toEqual(previous)
    await expect(getTranslationHistory()).resolves.toEqual([
      { ...previous, id: getResultId(previous) },
    ])
  })
})

describe('translation progress storage', () => {
  it('stores completed segments separately and clears them explicitly', async () => {
    const progress = createProgress()

    await saveTranslationProgress(progress)

    await expect(getTranslationProgress()).resolves.toEqual(progress)
    await clearTranslationProgress()
    await expect(getTranslationProgress()).resolves.toBeNull()
  })

  it('clears progress only when a different pending article is saved successfully', async () => {
    const pending: PendingTranslation = {
      title: 'New article',
      author: 'Author',
      sourceUrl: 'https://example.com/new',
      originalMarkdown: '# New article',
      createdAt: 2,
    }
    await saveTranslationProgress(createProgress())

    await savePendingTranslation(pending)

    await expect(getTranslationProgress()).resolves.toBeNull()
    await expect(chrome.storage.local.get('pendingTranslation')).resolves.toEqual({
      pendingTranslation: pending,
    })
  })

  it('clears pending content and progress atomically with a completed result', async () => {
    await savePendingTranslation({
      title: 'Pending',
      author: '',
      sourceUrl: 'https://example.com/pending',
      originalMarkdown: '# Pending',
      createdAt: 1,
    })
    await saveTranslationProgress(createProgress())

    await saveCompletedTranslation(createResult(2))

    await expect(
      chrome.storage.local.get(['pendingTranslation', 'translationProgress']),
    ).resolves.toEqual({})
  })

  it('ignores malformed stored progress', async () => {
    await chrome.storage.local.set({
      translationProgress: {
        ...createProgress(),
        completedSegments: [''],
      },
    })

    await expect(getTranslationProgress()).resolves.toBeNull()
  })
})

function createResult(index: number): TranslationResult {
  return {
    title: `Article ${index}`,
    author: `Author ${index}`,
    sourceUrl: `https://example.com/articles/${index}`,
    originalMarkdown: `# Article ${index}`,
    translatedMarkdown: `# 文章 ${index}`,
    createdAt: index,
  }
}

function getResultId(result: TranslationResult): string {
  return `${result.sourceUrl}:${result.createdAt}`
}

function toMetadata(result: TranslationResult) {
  return {
    id: getResultId(result),
    title: result.title,
    author: result.author,
    sourceUrl: result.sourceUrl,
    createdAt: result.createdAt,
  }
}

function createProgress(): TranslationProgress {
  return {
    sourceUrl: 'https://example.com/articles/1',
    articleCreatedAt: 1,
    segmentCount: 3,
    completedSegments: ['# 第一段'],
    updatedAt: 2,
  }
}
