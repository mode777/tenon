import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_ID_LENGTH,
  PROTOCOL_VERSION,
  SDK_VERSION,
  ExoProtocolError,
  buildEnvelope,
  isEnvelope,
} from './protocol'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }

describe('protocol constants', () => {
  it('uses the protocol major as the SDK major', () => {
    expect(PROTOCOL_VERSION).toBe('1')
    expect(SDK_VERSION.split('.')[0]).toBe(PROTOCOL_VERSION)
    expect(packageJson.version.split('.')[0]).toBe(PROTOCOL_VERSION)
  })
})

describe('envelope helpers', () => {
  it('accepts a valid envelope', () => {
    expect(isEnvelope({ exo: 1, type: 'plugin/ready', payload: {} })).toBe(true)
    expect(isEnvelope({ exo: 1, type: 'shell/init', id: 'a', replyTo: 'b' })).toBe(true)
  })

  it('rejects non-objects, missing markers and bad ids', () => {
    expect(isEnvelope(null)).toBe(false)
    expect(isEnvelope([])).toBe(false)
    expect(isEnvelope({ type: 'plugin/ready' })).toBe(false)
    expect(isEnvelope({ exo: 2, type: 'plugin/ready' })).toBe(false)
    expect(isEnvelope({ exo: 1, type: '' })).toBe(false)
    expect(isEnvelope({ exo: 1, type: 'x', id: '' })).toBe(false)
    expect(isEnvelope({ exo: 1, type: 'x', id: 'a'.repeat(MAX_ID_LENGTH + 1) })).toBe(false)
    expect(isEnvelope({ exo: 1, type: 'x', replyTo: 'a'.repeat(MAX_ID_LENGTH + 1) })).toBe(false)
  })

  it('builds an envelope without undefined fields', () => {
    expect(buildEnvelope('plugin/dirty', { dirty: true }, { id: 'r-1' })).toEqual({
      exo: 1,
      type: 'plugin/dirty',
      id: 'r-1',
      payload: { dirty: true },
    })
  })

  it('rejects an over-long request id before posting', () => {
    expect(() =>
      buildEnvelope('plugin/request-file', {}, { id: 'a'.repeat(MAX_ID_LENGTH + 1) }),
    ).toThrow(ExoProtocolError)
  })
})

describe('ExoProtocolError', () => {
  it('keeps the code and version details', () => {
    const error = new ExoProtocolError('unsupported-version', 'mismatch', {
      expected: '1',
      received: '2',
    })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ExoProtocolError')
    expect(error.code).toBe('unsupported-version')
    expect(error.expected).toBe('1')
    expect(error.received).toBe('2')
  })
})
