import { vi } from 'vitest'

type StorageGetKeys = string | string[] | Record<string, unknown> | null | undefined

const localStorageValues = new Map<string, unknown>()

function createEventMock() {
  return {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(() => false),
    hasListeners: vi.fn(() => false),
  }
}

function readStorage(keys: StorageGetKeys): Record<string, unknown> {
  if (keys == null) {
    return Object.fromEntries(localStorageValues)
  }

  if (typeof keys === 'string') {
    return localStorageValues.has(keys) ? { [keys]: localStorageValues.get(keys) } : {}
  }

  if (Array.isArray(keys)) {
    return Object.fromEntries(
      keys
        .filter((key) => localStorageValues.has(key))
        .map((key) => [key, localStorageValues.get(key)]),
    )
  }

  return Object.fromEntries(
    Object.entries(keys).map(([key, defaultValue]) => [
      key,
      localStorageValues.has(key) ? localStorageValues.get(key) : defaultValue,
    ]),
  )
}

function getStorageBytes(keys?: string | string[] | null): number {
  return new TextEncoder().encode(JSON.stringify(readStorage(keys))).byteLength
}

async function getStorageItems(keys?: StorageGetKeys): Promise<Record<string, unknown>> {
  return readStorage(keys)
}

async function setStorageItems(items: Record<string, unknown>): Promise<void> {
  Object.entries(items).forEach(([key, value]) => localStorageValues.set(key, value))
}

async function removeStorageItems(keys: string | string[]): Promise<void> {
  const normalizedKeys = Array.isArray(keys) ? keys : [keys]
  normalizedKeys.forEach((key) => localStorageValues.delete(key))
}

async function clearStorageItems(): Promise<void> {
  localStorageValues.clear()
}

const storageLocalMock = {
  QUOTA_BYTES: 10 * 1024 * 1024,
  get: vi.fn(getStorageItems),
  set: vi.fn(setStorageItems),
  remove: vi.fn(removeStorageItems),
  clear: vi.fn(clearStorageItems),
  getBytesInUse: vi.fn(async (keys?: string | string[] | null) => getStorageBytes(keys)),
  setAccessLevel: vi.fn(async () => undefined),
}

const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined,
    getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
    sendMessage: vi.fn(async () => undefined),
    onInstalled: createEventMock(),
    onMessage: createEventMock(),
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: createEventMock(),
  },
  storage: {
    local: storageLocalMock,
    onChanged: createEventMock(),
  },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined),
    getCurrent: vi.fn((callback: (tab?: chrome.tabs.Tab) => void) => callback(undefined)),
    remove: vi.fn(async () => undefined),
  },
  scripting: {
    executeScript: vi.fn(async () => []),
  },
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    getAll: vi.fn(async () => ({})),
    onAdded: createEventMock(),
    onRemoved: createEventMock(),
  },
  sidePanel: {
    open: vi.fn(async () => undefined),
  },
}

function createMatchMediaResult(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }
}

export function installBrowserMocks(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: chromeMock,
  })

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(createMatchMediaResult),
  })

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async () => undefined),
    },
  })

  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(() => true),
  })
}

export function resetBrowserMocks(): void {
  localStorageValues.clear()
  storageLocalMock.QUOTA_BYTES = 10 * 1024 * 1024
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.body.replaceChildren()
  vi.clearAllMocks()
  storageLocalMock.get.mockImplementation(getStorageItems)
  storageLocalMock.set.mockImplementation(setStorageItems)
  storageLocalMock.remove.mockImplementation(removeStorageItems)
  storageLocalMock.clear.mockImplementation(clearStorageItems)
  storageLocalMock.getBytesInUse.mockImplementation(
    async (keys?: string | string[] | null) => getStorageBytes(keys),
  )
}
