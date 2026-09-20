import { describe, expect, it } from 'vitest'
import { validateTranslationEndpoint } from './translationEndpoint'

describe('validateTranslationEndpoint', () => {
  it('accepts HTTPS and returns a normalized destination host', () => {
    expect(
      validateTranslationEndpoint('  https://API.Example.com:8443/compatible/v1/  '),
    ).toEqual({
      baseUrl: 'https://api.example.com:8443/compatible/v1',
      host: 'api.example.com:8443',
      isLocalHttp: false,
    })
  })

  it('removes path slashes without changing a query value', () => {
    expect(validateTranslationEndpoint('https://example.com/v1/?route=/')).toMatchObject({
      baseUrl: 'https://example.com/v1?route=/',
      host: 'example.com',
    })
  })

  it.each([
    ['http://localhost:3000/v1/', 'localhost:3000'],
    ['http://127.0.0.1:8787/v1', '127.0.0.1:8787'],
  ])('allows local HTTP debugging at %s', (baseUrl, host) => {
    expect(validateTranslationEndpoint(baseUrl)).toEqual({
      baseUrl: baseUrl.replace(/\/$/, ''),
      host,
      isLocalHttp: true,
    })
  })

  it.each([
    'http://api.example.com/v1',
    'http://localhost.example.com/v1',
    'http://127.0.0.2/v1',
    'http://[::1]/v1',
    'ftp://localhost/v1',
  ])('rejects an insecure non-local endpoint: %s', (baseUrl) => {
    expect(() => validateTranslationEndpoint(baseUrl)).toThrow(
      'Base URL 必须使用 HTTPS；HTTP 仅限 localhost 或 127.0.0.1',
    )
  })

  it.each(['', 'not-a-url'])('rejects an invalid endpoint: %s', (baseUrl) => {
    expect(() => validateTranslationEndpoint(baseUrl)).toThrow('Base URL')
  })
})
