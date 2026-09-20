import { describe, expect, it } from 'vitest'
import manifest from '../../public/manifest.json'

describe('extension permissions', () => {
  it('does not retain static access to every website', () => {
    expect(manifest).not.toHaveProperty('content_scripts')
    expect(manifest).not.toHaveProperty('host_permissions')
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>')
  })

  it('uses active-tab injection and optional model endpoint access', () => {
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['activeTab', 'scripting']),
    )
    expect(manifest.optional_host_permissions).toEqual([
      'https://*/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ])
  })

  it('loads the code-split background worker as an ES module', () => {
    expect(manifest.background).toEqual({
      service_worker: 'background.js',
      type: 'module',
    })
  })
})
