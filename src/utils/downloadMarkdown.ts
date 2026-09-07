const FALLBACK_FILENAME = '翻译结果'
const MAX_FILENAME_LENGTH = 80

export function downloadMarkdown(markdown: string, title: string): void {
  if (!markdown.trim()) {
    throw new Error('没有可下载的翻译结果')
  }

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = objectUrl
  anchor.download = createMarkdownFilename(title)
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export function createMarkdownFilename(title: string): string {
  const safeTitle = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)

  return `${safeTitle || FALLBACK_FILENAME}.md`
}
