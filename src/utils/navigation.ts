// 扩展页面导航工具：打开扩展页面 / 关闭当前标签页
export type ExtensionPage = 'result' | 'settings'

// 在新标签页中打开指定的扩展页面
export function openExtensionPage(page: ExtensionPage): void {
  const url = chrome.runtime.getURL(`${page}.html`)
  chrome.tabs.create({ url })
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
