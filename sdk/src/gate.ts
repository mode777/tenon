import { ExoProtocolError, isEnvelope, type Envelope, type EnvelopeOptions } from './protocol'
import type { PluginTransport } from './transport'

type GateHandler = (envelope: Envelope) => void

/**
 * One fail-closed path for every incoming message. The gate verifies the parent
 * source and the exact host origin before parsing an envelope, then dispatches
 * by type. Clients only ever see messages that passed all three checks.
 */
export class MessageGate {
  private readonly handlers = new Map<string, Set<GateHandler>>()
  private readonly anyHandlers = new Set<GateHandler>()
  private readonly unsubscribe: () => void
  private isClosed = false

  constructor(private readonly transport: PluginTransport) {
    this.unsubscribe = transport.receive((message, meta) => this.handle(message, meta))
  }

  get closed(): boolean {
    return this.isClosed
  }

  on(type: string, handler: GateHandler): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  }

  onAny(handler: GateHandler): () => void {
    this.anyHandlers.add(handler)
    return () => {
      this.anyHandlers.delete(handler)
    }
  }

  send(type: string, payload?: unknown, options: EnvelopeOptions = {}): void {
    if (this.isClosed) {
      throw new ExoProtocolError('closed', 'The plugin connection is closed.')
    }
    this.transport.post({
      exo: 1,
      type,
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
      ...(payload === undefined ? {} : { payload }),
    })
  }

  close(): void {
    if (this.isClosed) return
    this.isClosed = true
    this.unsubscribe()
    this.handlers.clear()
    this.anyHandlers.clear()
  }

  private handle(message: unknown, meta: { origin: string; source: unknown }): void {
    if (this.isClosed) return
    if (meta.source !== this.transport.parent) return
    if (meta.origin !== this.transport.hostOrigin) return
    if (!isEnvelope(message)) return
    const envelope = message

    const handlers = this.handlers.get(envelope.type)
    if (handlers) {
      for (const handler of [...handlers]) handler(envelope)
    }
    for (const handler of [...this.anyHandlers]) handler(envelope)
  }
}
