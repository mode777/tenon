import { describe, expect, it } from 'vitest'
import * as sdk from './index'

describe('DOM-free core', () => {
  it('imports and exposes constants without browser globals', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    expect(typeof location).toBe('undefined')
    expect(typeof (globalThis as { parent?: unknown }).parent).toBe('undefined')
    expect(sdk.PROTOCOL_VERSION).toBe('1')
    expect(sdk.SDK_VERSION).toBe('1.8.0')
    expect(typeof sdk.connectPlugin).toBe('function')
  })
})
