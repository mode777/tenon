import { describe, expect, it, vi } from 'vitest'
import { MessageGate } from './gate'
import { FakePluginTransport } from './testing'

function setup() {
  const transport = new FakePluginTransport()
  const gate = new MessageGate(transport)
  const handler = vi.fn()
  gate.on('shell/init', handler)
  return { transport, gate, handler }
}

describe('message gate', () => {
  it('dispatches a valid message from the parent and host origin', () => {
    const { transport, handler } = setup()
    transport.emit({ exo: 1, type: 'shell/init', payload: { ok: true } })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('drops a foreign origin', () => {
    const { transport, handler } = setup()
    transport.emit({ exo: 1, type: 'shell/init' }, { origin: 'https://evil.example.com' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('drops a wrong source', () => {
    const { transport, handler } = setup()
    transport.emit({ exo: 1, type: 'shell/init' }, { source: { name: 'other' } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('drops a malformed envelope', () => {
    const { transport, handler } = setup()
    transport.emit({ exo: 1, type: '' })
    transport.emit({ exo: 2, type: 'shell/init' })
    transport.emit('shell/init')
    expect(handler).not.toHaveBeenCalled()
  })

  it('stops dispatching after close', () => {
    const { transport, gate, handler } = setup()
    gate.close()
    transport.emit({ exo: 1, type: 'shell/init' })
    expect(handler).not.toHaveBeenCalled()
    expect(gate.closed).toBe(true)
  })

  it('does not expose postMessage targets to core clients', () => {
    const { transport, gate } = setup()
    gate.send('plugin/dirty', { dirty: false })
    expect(transport.posted.at(-1)).toEqual({
      exo: 1,
      type: 'plugin/dirty',
      payload: { dirty: false },
    })
  })
})
