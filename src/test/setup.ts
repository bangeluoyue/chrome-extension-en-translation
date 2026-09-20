import { beforeEach } from 'vitest'
import { installBrowserMocks, resetBrowserMocks } from './browserMocks'

installBrowserMocks()

beforeEach(() => {
  resetBrowserMocks()
})
