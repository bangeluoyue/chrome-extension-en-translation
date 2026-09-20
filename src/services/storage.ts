import { validateTranslationEndpoint } from '../lib/translationEndpoint'
import {
  STORAGE_CAPACITY_ERROR_MESSAGE,
  type CompletedTranslationSaveResult,
  type PendingSelection,
  type PendingTranslation,
  type TranslationHistoryEntry,
  type TranslationProgress,
  type TranslationResult,
  type UserConfig,
} from '../types'

const MAX_TRANSLATION_HISTORY = 20
const CURRENT_STORAGE_VERSION = 1
const FALLBACK_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024

const STORAGE_KEYS = {
  version: 'storageVersion',
  userConfig: 'userConfig',
  results: 'translationResults',
  lastResult: 'lastResult',
  pendingTranslation: 'pendingTranslation',
  translationProgress: 'translationProgress',
  pendingSelection: 'pendingSelection',
  translationHistory: 'translationHistory',
} as const

const RESULT_STORAGE_KEYS: string[] = [
  STORAGE_KEYS.version,
  STORAGE_KEYS.results,
  STORAGE_KEYS.lastResult,
  STORAGE_KEYS.translationHistory,
]

interface StoredTranslationMetadata {
  id: string
  title: string
  author: string
  sourceUrl: string
  createdAt: number
}

interface TranslationStorageState {
  results: Record<string, TranslationResult>
  lastResultId: string | null
  history: StoredTranslationMetadata[]
}

interface CapacityWriteResult {
  removedHistoryCount: number
}

let resultStorageQueue: Promise<void> = Promise.resolve()

export const DEFAULT_CONFIG: UserConfig = {
  apiKey: '',
  model: 'qwen-plus',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

export async function getUserConfig(): Promise<UserConfig> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.userConfig)
  const saved = data[STORAGE_KEYS.userConfig] as Partial<UserConfig> | undefined
  return saved ? { ...DEFAULT_CONFIG, ...saved } : { ...DEFAULT_CONFIG }
}

export async function saveUserConfig(config: UserConfig): Promise<void> {
  const endpoint = validateTranslationEndpoint(config.baseUrl)
  await chrome.storage.local.set({
    [STORAGE_KEYS.userConfig]: { ...config, baseUrl: endpoint.baseUrl },
  })
}

export async function clearUserApiKey(): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.userConfig)
  const saved = data[STORAGE_KEYS.userConfig]

  if (typeof saved !== 'object' || saved === null) {
    return
  }

  const { apiKey: _apiKey, ...configWithoutApiKey } = saved as Record<string, unknown>
  await chrome.storage.local.set({
    [STORAGE_KEYS.userConfig]: configWithoutApiKey,
  })
}

// 读取最近结果时自动迁移旧的完整 lastResult / translationHistory 结构。
export function getLastResult(): Promise<TranslationResult | null> {
  return withResultStorage(async () => {
    await migrateTranslationStorage()
    const state = await readTranslationStorageState()

    return state.lastResultId ? state.results[state.lastResultId] ?? null : null
  })
}

export function saveCompletedTranslation(
  result: TranslationResult,
): Promise<CompletedTranslationSaveResult> {
  return withResultStorage(async () => {
    await migrateTranslationStorage()
    const current = await readTranslationStorageState()
    const id = getTranslationHistoryId(result)
    const history = [
      toStoredMetadata(result, id),
      ...current.history.filter((entry) => entry.id !== id),
    ]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_TRANSLATION_HISTORY)
    const nextState: TranslationStorageState = {
      results: retainReferencedResults(
        { ...current.results, [id]: result },
        history,
        id,
      ),
      lastResultId: id,
      history,
    }
    const writeResult = await writeWithCapacityCleanup(nextState, {
      [STORAGE_KEYS.pendingTranslation]: null,
      [STORAGE_KEYS.translationProgress]: null,
    })

    // null 已使读取立即返回空；删除仅用于避免遗留无意义键。
    await chrome.storage.local
      .remove([STORAGE_KEYS.pendingTranslation, STORAGE_KEYS.translationProgress])
      .catch(() => undefined)

    return { removedHistoryCount: writeResult.removedHistoryCount }
  })
}

export function clearLastResult(): Promise<void> {
  return withResultStorage(async () => {
    await migrateTranslationStorage()
    await chrome.storage.local.set({ [STORAGE_KEYS.lastResult]: null })
  })
}

export async function getPendingTranslation(): Promise<PendingTranslation | null> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.pendingTranslation)
  return (data[STORAGE_KEYS.pendingTranslation] as PendingTranslation | undefined) ?? null
}

export function savePendingTranslation(pending: PendingTranslation): Promise<void> {
  return withResultStorage(async () => {
    await migrateTranslationStorage()
    const state = await readTranslationStorageState()
    await writeWithCapacityCleanup(state, {
      [STORAGE_KEYS.pendingTranslation]: pending,
      [STORAGE_KEYS.translationProgress]: null,
    })
    await chrome.storage.local.remove(STORAGE_KEYS.translationProgress).catch(() => undefined)
  })
}

export async function clearPendingTranslation(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.pendingTranslation)
}

export async function getTranslationProgress(): Promise<TranslationProgress | null> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.translationProgress)
  const progress = data[STORAGE_KEYS.translationProgress]

  return isTranslationProgress(progress) ? progress : null
}

export function saveTranslationProgress(progress: TranslationProgress): Promise<void> {
  return withResultStorage(async () => {
    await migrateTranslationStorage()
    const state = await readTranslationStorageState()
    await writeWithCapacityCleanup(state, {
      [STORAGE_KEYS.translationProgress]: progress,
    })
  })
}

export async function clearTranslationProgress(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.translationProgress)
}

export async function getPendingSelection(): Promise<PendingSelection | null> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.pendingSelection)
  return (data[STORAGE_KEYS.pendingSelection] as PendingSelection | undefined) ?? null
}

export async function savePendingSelection(selection: PendingSelection): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingSelection]: selection })
}

export async function clearPendingSelection(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.pendingSelection)
}

export function getTranslationHistory(): Promise<TranslationHistoryEntry[]> {
  return withResultStorage(async () => {
    await migrateTranslationStorage()
    return hydrateTranslationHistory(await readTranslationStorageState())
  })
}

export function deleteTranslationFromHistory(
  id: string,
): Promise<TranslationHistoryEntry[]> {
  return withResultStorage(async () => {
    await migrateTranslationStorage()
    const current = await readTranslationStorageState()
    const history = current.history.filter((entry) => entry.id !== id)

    if (history.length === current.history.length) {
      return hydrateTranslationHistory(current)
    }

    const lastResultId = current.lastResultId === id
      ? history[0]?.id ?? null
      : current.lastResultId
    const nextState: TranslationStorageState = {
      results: retainReferencedResults(current.results, history, lastResultId),
      lastResultId,
      history,
    }

    await chrome.storage.local.set(toStorageUpdates(nextState))
    return hydrateTranslationHistory(nextState)
  })
}

function withResultStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = resultStorageQueue.then(operation, operation)
  resultStorageQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function migrateTranslationStorage(): Promise<void> {
  const data = await chrome.storage.local.get(RESULT_STORAGE_KEYS)

  if (data[STORAGE_KEYS.version] === CURRENT_STORAGE_VERSION) {
    return
  }

  const results = normalizeStoredResults(data[STORAGE_KEYS.results])
  const historyById = new Map<string, StoredTranslationMetadata>()
  const rawHistory = data[STORAGE_KEYS.translationHistory]

  if (Array.isArray(rawHistory)) {
    rawHistory.forEach((value) => {
      const result = toTranslationResult(value)

      if (result) {
        const id = getStoredResultId(value, result)
        results[id] = result
        historyById.set(id, toStoredMetadata(result, id))
        return
      }

      const metadata = toStoredMetadataFromUnknown(value)
      if (metadata && results[metadata.id]) {
        historyById.set(metadata.id, metadata)
      }
    })
  }

  const legacyLastResult = toTranslationResult(data[STORAGE_KEYS.lastResult])
  let lastResultId =
    typeof data[STORAGE_KEYS.lastResult] === 'string'
      ? data[STORAGE_KEYS.lastResult] as string
      : null

  if (legacyLastResult) {
    lastResultId = getTranslationHistoryId(legacyLastResult)
    results[lastResultId] = legacyLastResult
    historyById.set(lastResultId, toStoredMetadata(legacyLastResult, lastResultId))
  }

  if (lastResultId && !results[lastResultId]) {
    lastResultId = null
  }

  const history = [...historyById.values()].sort(
    (left, right) => right.createdAt - left.createdAt,
  )
  if (!lastResultId) {
    lastResultId = history[0]?.id ?? null
  }
  const migratedState: TranslationStorageState = {
    results: retainReferencedResults(results, history, lastResultId),
    lastResultId,
    history,
  }

  // 同一次 set 覆盖旧的大字段并写入记录表，迁移过程中不会产生双份峰值。
  await chrome.storage.local.set(toStorageUpdates(migratedState))
}

async function readTranslationStorageState(): Promise<TranslationStorageState> {
  const data = await chrome.storage.local.get(RESULT_STORAGE_KEYS)
  const results = normalizeStoredResults(data[STORAGE_KEYS.results])
  const rawHistory = data[STORAGE_KEYS.translationHistory]
  const history = Array.isArray(rawHistory)
    ? rawHistory
        .map(toStoredMetadataFromUnknown)
        .filter((entry): entry is StoredTranslationMetadata => Boolean(entry && results[entry.id]))
    : []
  const storedLastResultId = data[STORAGE_KEYS.lastResult]
  const lastResultId =
    storedLastResultId === null
      ? null
      : typeof storedLastResultId === 'string' && results[storedLastResultId]
        ? storedLastResultId
        : history[0]?.id ?? null

  return {
    results: retainReferencedResults(results, history, lastResultId),
    lastResultId,
    history,
  }
}

async function writeWithCapacityCleanup(
  initialState: TranslationStorageState,
  additionalUpdates: Record<string, unknown>,
): Promise<CapacityWriteResult> {
  const affectedKeys = [...new Set([...RESULT_STORAGE_KEYS, ...Object.keys(additionalUpdates)])]
  const previousValues = await chrome.storage.local.get(affectedKeys)
  const initialHistoryIds = new Set(initialState.history.map((entry) => entry.id))
  const quotaBytes = chrome.storage.local.QUOTA_BYTES ?? FALLBACK_STORAGE_QUOTA_BYTES
  const currentTotalBytes = await getBytesInUseSafely(null)
  const currentAffectedBytes = await getBytesInUseSafely(affectedKeys)
  let state = initialState

  if (currentTotalBytes !== null && currentAffectedBytes !== null) {
    while (
      currentTotalBytes - currentAffectedBytes +
        estimateStorageBytes({ ...toStorageUpdates(state), ...additionalUpdates }) >
      quotaBytes
    ) {
      const reduced = removeOldestHistory(state)
      if (!reduced) {
        throw new Error(STORAGE_CAPACITY_ERROR_MESSAGE)
      }
      state = reduced
    }
  }

  while (true) {
    try {
      await chrome.storage.local.set({
        ...toStorageUpdates(state),
        ...additionalUpdates,
      })
      break
    } catch (error) {
      if (!isQuotaError(error)) {
        throw error
      }

      const reduced = removeOldestHistory(state)
      if (!reduced) {
        throw new Error(STORAGE_CAPACITY_ERROR_MESSAGE)
      }
      state = reduced
    }
  }

  let storedBytes = await getBytesInUseSafely(null)
  while (storedBytes !== null && storedBytes > quotaBytes) {
    const reduced = removeOldestHistory(state)

    if (!reduced) {
      await restoreStorageValues(affectedKeys, previousValues)
      throw new Error(STORAGE_CAPACITY_ERROR_MESSAGE)
    }

    state = reduced
    try {
      await chrome.storage.local.set({
        ...toStorageUpdates(state),
        ...additionalUpdates,
      })
    } catch (error) {
      await restoreStorageValues(affectedKeys, previousValues)
      throw isQuotaError(error) ? new Error(STORAGE_CAPACITY_ERROR_MESSAGE) : error
    }
    storedBytes = await getBytesInUseSafely(null)
  }

  const retainedIds = new Set(state.history.map((entry) => entry.id))
  const removedHistoryCount = [...initialHistoryIds].filter(
    (id) => !retainedIds.has(id),
  ).length

  return { removedHistoryCount }
}

function removeOldestHistory(
  state: TranslationStorageState,
): TranslationStorageState | null {
  let removableIndex = -1

  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    if (state.history[index].id !== state.lastResultId) {
      removableIndex = index
      break
    }
  }

  if (removableIndex < 0) {
    return null
  }

  const history = state.history.filter((_entry, index) => index !== removableIndex)
  return {
    results: retainReferencedResults(state.results, history, state.lastResultId),
    lastResultId: state.lastResultId,
    history,
  }
}

function toStorageUpdates(state: TranslationStorageState): Record<string, unknown> {
  return {
    [STORAGE_KEYS.version]: CURRENT_STORAGE_VERSION,
    [STORAGE_KEYS.results]: state.results,
    [STORAGE_KEYS.lastResult]: state.lastResultId,
    [STORAGE_KEYS.translationHistory]: state.history,
  }
}

function hydrateTranslationHistory(
  state: TranslationStorageState,
): TranslationHistoryEntry[] {
  return state.history.flatMap((metadata) => {
    const result = state.results[metadata.id]
    return result ? [{ ...result, id: metadata.id }] : []
  })
}

function retainReferencedResults(
  results: Record<string, TranslationResult>,
  history: StoredTranslationMetadata[],
  lastResultId: string | null,
): Record<string, TranslationResult> {
  const retainedIds = new Set(history.map((entry) => entry.id))
  if (lastResultId) {
    retainedIds.add(lastResultId)
  }

  return Object.fromEntries(
    [...retainedIds]
      .map((id) => [id, results[id]] as const)
      .filter((entry): entry is readonly [string, TranslationResult] => Boolean(entry[1])),
  )
}

function normalizeStoredResults(value: unknown): Record<string, TranslationResult> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([id, storedResult]) => {
      const result = toTranslationResult(storedResult)
      return result ? [[id, result]] : []
    }),
  )
}

function toTranslationResult(value: unknown): TranslationResult | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const result = value as Record<string, unknown>
  if (
    typeof result.title !== 'string' ||
    typeof result.author !== 'string' ||
    typeof result.sourceUrl !== 'string' ||
    typeof result.originalMarkdown !== 'string' ||
    typeof result.translatedMarkdown !== 'string' ||
    typeof result.createdAt !== 'number' ||
    !Number.isFinite(result.createdAt)
  ) {
    return null
  }

  return {
    title: result.title,
    author: result.author,
    sourceUrl: result.sourceUrl,
    originalMarkdown: result.originalMarkdown,
    translatedMarkdown: result.translatedMarkdown,
    createdAt: result.createdAt,
  }
}

function toStoredMetadata(
  result: TranslationResult,
  id: string,
): StoredTranslationMetadata {
  return {
    id,
    title: result.title,
    author: result.author,
    sourceUrl: result.sourceUrl,
    createdAt: result.createdAt,
  }
}

function toStoredMetadataFromUnknown(value: unknown): StoredTranslationMetadata | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const metadata = value as Record<string, unknown>
  if (
    typeof metadata.id !== 'string' ||
    typeof metadata.title !== 'string' ||
    typeof metadata.author !== 'string' ||
    typeof metadata.sourceUrl !== 'string' ||
    typeof metadata.createdAt !== 'number' ||
    !Number.isFinite(metadata.createdAt)
  ) {
    return null
  }

  return {
    id: metadata.id,
    title: metadata.title,
    author: metadata.author,
    sourceUrl: metadata.sourceUrl,
    createdAt: metadata.createdAt,
  }
}

function getStoredResultId(value: unknown, result: TranslationResult): string {
  if (typeof value === 'object' && value !== null) {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'string' && id) {
      return id
    }
  }

  return getTranslationHistoryId(result)
}

function getTranslationHistoryId(result: TranslationResult): string {
  return `${result.sourceUrl}:${result.createdAt}`
}

async function getBytesInUseSafely(keys: string[] | null): Promise<number | null> {
  try {
    return await chrome.storage.local.getBytesInUse(keys)
  } catch {
    return null
  }
}

function estimateStorageBytes(items: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(items)).byteLength
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('quota') || message.includes('exceed') || message.includes('maximum')
}

async function restoreStorageValues(
  affectedKeys: string[],
  previousValues: Record<string, unknown>,
): Promise<void> {
  const keysToRemove = affectedKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(previousValues, key),
  )

  await chrome.storage.local.set(previousValues)
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove)
  }
}

function isTranslationProgress(value: unknown): value is TranslationProgress {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const progress = value as Record<string, unknown>
  return (
    typeof progress.sourceUrl === 'string' &&
    typeof progress.articleCreatedAt === 'number' &&
    Number.isFinite(progress.articleCreatedAt) &&
    typeof progress.segmentCount === 'number' &&
    Number.isInteger(progress.segmentCount) &&
    progress.segmentCount > 0 &&
    Array.isArray(progress.completedSegments) &&
    progress.completedSegments.length <= progress.segmentCount &&
    progress.completedSegments.every(
      (segment) => typeof segment === 'string' && Boolean(segment.trim()),
    ) &&
    typeof progress.updatedAt === 'number' &&
    Number.isFinite(progress.updatedAt)
  )
}
