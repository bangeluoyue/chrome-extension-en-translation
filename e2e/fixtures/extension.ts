import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
} from '@playwright/test'

interface ExtensionFixtures {
  extensionContext: BrowserContext
  extensionId: string
  grantHostPermission: (origin: string) => Promise<void>
}

export const test = base.extend<ExtensionFixtures>({
  extensionContext: async ({}, use, testInfo) => {
    const extensionPath = path.resolve('dist')
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'translation-e2e-'))
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })

    await context.route(/^https?:\/\//, async (route) => {
      const hostname = new URL(route.request().url()).hostname

      if (hostname === '127.0.0.1' || hostname === 'localhost') {
        await route.continue()
      } else {
        await route.abort('blockedbyclient')
      }
    })

    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })

    try {
      await use(context)
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus

      if (failed) {
        for (const [index, page] of context.pages().entries()) {
          if (page.isClosed()) {
            continue
          }

          await page.screenshot({
            path: testInfo.outputPath(`failure-page-${index + 1}.png`),
            fullPage: true,
          }).catch(() => undefined)
        }

        const tracePath = testInfo.outputPath('trace.zip')
        await context.tracing.stop({ path: tracePath }).catch(() => undefined)
        await testInfo
          .attach('playwright-trace', { path: tracePath, contentType: 'application/zip' })
          .catch(() => undefined)
      } else {
        await context.tracing.stop().catch(() => undefined)
      }

      await context.close().catch(() => undefined)
      await rm(userDataDir, { recursive: true, force: true })
    }
  },

  extensionId: async ({ extensionContext }, use) => {
    let [serviceWorker] = extensionContext.serviceWorkers()
    serviceWorker ??= await extensionContext.waitForEvent('serviceworker')
    await use(new URL(serviceWorker.url()).hostname)
  },

  grantHostPermission: async ({ extensionContext, extensionId }, use) => {
    await use(async (origin) => {
      const extensionsPage = await extensionContext.newPage()

      try {
        await extensionsPage.goto(`chrome://extensions/?id=${extensionId}`)
        await extensionsPage.evaluate(
          async ({ id, host }) => {
            const browserChrome = chrome as typeof chrome & {
              developerPrivate: {
                addHostPermission: (extensionId: string, origin: string) => Promise<void>
              }
            }

            // Headless Chromium cannot click its native permission bubble. This is
            // the same browser-level grant used by chrome://extensions, after which
            // the product still executes and verifies permissions.request().
            await browserChrome.developerPrivate.addHostPermission(id, host)
          },
          { id: extensionId, host: origin },
        )
      } finally {
        await extensionsPage.close()
      }
    })
  },
})

export { expect }
