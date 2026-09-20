// 扩展页面导航工具：打开扩展页面 / 关闭当前标签页
export type ExtensionPage = 'result' | 'settings'

// 在新标签页中打开指定的扩展页面
export function openExtensionPage(page: ExtensionPage): void {
  const url = chrome.runtime.getURL(`${page}.html`)
  chrome.tabs.create({ url })
}

// 优先在当前网页旁打开阅读侧边栏；旧版 Chrome 或打开失败时退回结果页。
export async function openReadingWorkspace(): Promise<'sidepanel' | 'result'> {
  if (!chrome.sidePanel?.open) {
    openExtensionPage('result')
    return 'result'
  }

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (activeTab?.id === undefined) {
      throw new Error('未找到当前标签页')
    }

    await chrome.sidePanel.open({ tabId: activeTab.id })
    return 'sidepanel'
  } catch {
    openExtensionPage('result')
    return 'result'
  }
}

// 关闭当前标签页（用于结果页 / 设置页的「返回」）
export function closeCurrentPage(): void {
  chrome.tabs.getCurrent((tab) => {
    if (tab?.id != null) {
      chrome.tabs.remove(tab.id)
    } else {
      window.close()
    }
  })
}
