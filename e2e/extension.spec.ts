import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures/extension'
import { startFakeOpenAIService } from './fixtures/fakeOpenAI'

test('全新浏览器配置完成文章翻译核心闭环', async ({
  extensionContext,
  extensionId,
  grantHostPermission,
}, testInfo) => {
  const fakeService = await startFakeOpenAIService()
  const extensionOrigin = `chrome-extension://${extensionId}`

  try {
    const settingsPage = await extensionContext.newPage()
    await settingsPage.goto(`${extensionOrigin}/settings.html`)
    await expect(settingsPage.locator('#api-key')).toBeEnabled()
    await settingsPage.locator('#api-key').fill('e2e-local-key')
    await settingsPage.locator('#model').fill('e2e-model')
    await settingsPage.locator('#base-url').fill(fakeService.baseUrl)
    await expect(settingsPage.getByText(/模型端点权限：未允许/)).toBeVisible()
    await expect(
      settingsPage.evaluate(
        (origin) => chrome.permissions.contains({ origins: [origin] }),
        'http://127.0.0.1/*',
      ),
    ).resolves.toBe(false)

    await grantHostPermission('http://127.0.0.1/*')
    await settingsPage.getByRole('button', { name: '测试连接' }).click()
    await expect(settingsPage.getByRole('status')).toContainText('连接成功')
    await settingsPage.getByRole('button', { name: '保存', exact: true }).click()
    await expect(settingsPage.getByRole('status')).toContainText('配置已保存')
    await expect
      .poll(() =>
        settingsPage.evaluate(
          (origin) => chrome.permissions.contains({ origins: [origin] }),
          'http://127.0.0.1/*',
        ),
      )
      .toBe(true)

    const articlePage = await extensionContext.newPage()
    await articlePage.goto(fakeService.articleUrl)
    await expect(articlePage.getByRole('heading', { name: 'E2E Long Article' })).toBeVisible()

    const popupPage = await extensionContext.newPage()
    await popupPage.goto(`${extensionOrigin}/popup.html`)
    await articlePage.bringToFront()
    await popupPage.reload()
    await expect(popupPage.getByText('E2E Long Article', { exact: true })).toBeVisible()
    await popupPage.evaluate(() => {
      // Side Panel targets are not exposed as Playwright pages in headless mode.
      // Exercise the production fallback here, then open sidepanel.html separately.
      Object.defineProperty(chrome.sidePanel, 'open', { value: undefined })
    })
    const resultPagePromise = extensionContext.waitForEvent('page')
    await popupPage.getByRole('button', { name: '在侧边栏翻译文章' }).click()
    await expect(popupPage.getByRole('status')).toContainText('已就绪')
    const readerPage = await resultPagePromise
    await readerPage.waitForURL(`${extensionOrigin}/result.html`)

    await expect(readerPage.getByRole('heading', { name: 'E2E Long Article' })).toBeVisible()
    await expect(readerPage.getByLabel('文章规模预检')).toContainText('长文章')
    await expect(readerPage.getByRole('status').filter({ hasText: '翻译完成' })).toBeVisible({
      timeout: 60_000,
    })
    await expect(readerPage.getByText('E2E_SEGMENT_TRANSLATION_1')).toBeVisible()

    const streamRequests = fakeService.requests.filter((request) => request.stream)
    expect(streamRequests.length).toBeGreaterThanOrEqual(2)

    await readerPage.getByRole('button', { name: '仅原文' }).click()
    await expect(readerPage.getByText('E2E_ORIGINAL_SENTINEL')).toBeVisible()
    await readerPage.getByRole('button', { name: '双语对照' }).click()
    await expect(readerPage.getByText('E2E_SEGMENT_TRANSLATION_1')).toBeVisible()
    await expect(readerPage.getByText('E2E_ORIGINAL_SENTINEL')).toBeVisible()
    await readerPage.getByRole('button', { name: '仅译文' }).click()
    await expect(readerPage.getByText('E2E_ORIGINAL_SENTINEL')).toHaveCount(0)

    await readerPage.getByRole('button', { name: '复制 ▾', exact: true }).click()
    await readerPage.getByRole('menuitem', { name: '双语 Markdown' }).click()
    await expect(readerPage.getByRole('button', { name: '已复制双语' })).toBeVisible()

    const downloadPromise = readerPage.waitForEvent('download')
    await readerPage.getByRole('button', { name: '下载', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('E2E Long Article.md')
    const downloadPath = testInfo.outputPath(download.suggestedFilename())
    await download.saveAs(downloadPath)
    const downloadedMarkdown = await readFile(downloadPath, 'utf8')
    expect(downloadedMarkdown).toContain('E2E\\_ORIGINAL\\_SENTINEL')
    expect(downloadedMarkdown).toContain('E2E_SEGMENT_TRANSLATION_1')

    const sidepanelPage = await extensionContext.newPage()
    await sidepanelPage.goto(`${extensionOrigin}/sidepanel.html`)
    await expect(sidepanelPage.getByRole('heading', { name: 'E2E Long Article' })).toBeVisible()
    await expect(sidepanelPage.getByRole('status')).toContainText('已恢复最近一次翻译结果')

    await sidepanelPage.evaluate(
      ({ sourceUrl }) =>
        chrome.storage.local.set({
          pendingSelection: {
            sourceText: 'The browser parses HTML.',
            pageTitle: 'E2E Long Article',
            sourceUrl,
          },
        }),
      { sourceUrl: fakeService.articleUrl },
    )
    await expect(sidepanelPage.getByRole('heading', { name: '划词翻译' })).toBeVisible()
    await expect(sidepanelPage.getByText('划词译文：浏览器解析 HTML。')).toBeVisible()
    await sidepanelPage.getByRole('button', { name: '复制译文' }).click()
    await expect(sidepanelPage.getByRole('button', { name: '已复制' })).toBeVisible()

    const requestsBeforeHistory = fakeService.requests.length
    await sidepanelPage.getByRole('button', { name: '历史' }).click()
    await expect(sidepanelPage.getByRole('heading', { name: '最近阅读（1）' })).toBeVisible()
    const historyEntry = sidepanelPage.locator('.history-list__open').filter({
      hasText: 'E2E Long Article',
    })
    await expect(historyEntry).toBeVisible()
    await historyEntry.click()
    await expect(sidepanelPage.getByRole('status')).toContainText('已打开历史翻译')
    expect(fakeService.requests).toHaveLength(requestsBeforeHistory)
  } finally {
    await fakeService.close()
  }
})
