// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createBrowserTransport, parseExoFragment } from './browser'
import type { Envelope } from './protocol'

const SHELL_ORIGIN = 'https://editor.example.com'

function fragment(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    'exo-host': SHELL_ORIGIN,
    'exo-mode': 'register',
    'exo-session': 'session-1',
    ...overrides,
  })
  return `#${params.toString()}`
}

function fakeWindow(hash: string, topLevel = false) {
  const listeners = new Set<(event: MessageEvent) => void>()
  const parent = { postMessage: vi.fn() }
  const win: Record<string, unknown> = {
    location: { hash },
    parent: null,
    addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.delete(listener)
    }),
  }
  win.parent = topLevel ? win : parent
  return { win: win as unknown as Window, parent, listeners }
}

describe('browser adapter', () => {
  it('parses a valid fragment', () => {
    expect(parseExoFragment(fragment())).toEqual({
      hostOrigin: SHELL_ORIGIN,
      mode: 'register',
      sessionId: 'session-1',
    })
    expect(parseExoFragment(fragment({ 'exo-mode': 'view' })).mode).toBe('view')
  })

  it('rejects missing and invalid parameters', () => {
    expect(() => parseExoFragment('')).toThrow(/exo-host/)
    expect(() =>
      parseExoFragment(fragment({ 'exo-host': 'https://editor.example.com/path' })),
    ).toThrow(/origin/)
    expect(() => parseExoFragment(fragment({ 'exo-mode': 'other' }))).toThrow(/exo-mode/)
    expect(() => parseExoFragment(fragment({ 'exo-session': '' }))).toThrow(/exo-session/)
  })

  it('refuses a top-level page', () => {
    const { win } = fakeWindow(fragment(), true)
    expect(() => createBrowserTransport({ window: win })).toThrow(/embedded/)
  })

  it('posts to the exact host origin and receives messages', () => {
    const { win, parent, listeners } = fakeWindow(fragment())
    const transport = createBrowserTransport({ window: win })
    expect(transport.hostOrigin).toBe(SHELL_ORIGIN)
    expect(transport.mode).toBe('register')
    expect(transport.sessionId).toBe('session-1')

    const message: Envelope = { exo: 1, type: 'plugin/ready' }
    transport.post(message)
    expect(parent.postMessage).toHaveBeenCalledWith(message, SHELL_ORIGIN)
    expect(parent.postMessage).not.toHaveBeenCalledWith(message, '*')

    const received = vi.fn()
    const off = transport.receive(received)
    const listener = [...listeners][0]
    listener({ data: message, origin: SHELL_ORIGIN, source: parent } as unknown as MessageEvent)
    expect(received).toHaveBeenCalledWith(message, { origin: SHELL_ORIGIN, source: parent })
    off()
    expect(listeners).toHaveLength(0)
  })
})
