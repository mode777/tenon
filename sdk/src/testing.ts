import type { Envelope, PluginMode } from './protocol'
import type { PluginTransport, TransportListener, TransportMessageMeta } from './transport'

export interface FakePluginTransportOptions {
  hostOrigin?: string
  mode?: PluginMode
  sessionId?: string
  parent?: unknown
  onPost?: (message: Envelope) => void
}

/**
 * Test-only transport. It records outgoing envelopes and injects incoming
 * messages with explicit origin/source metadata so the gate can be exercised
 * without a browser.
 */
export class FakePluginTransport implements PluginTransport {
  readonly hostOrigin: string
  readonly mode: PluginMode
  readonly sessionId: string
  readonly parent: unknown
  readonly posted: Envelope[] = []
  private readonly listeners = new Set<TransportListener>()
  private readonly onPost: ((message: Envelope) => void) | undefined

  constructor(options: FakePluginTransportOptions = {}) {
    this.hostOrigin = options.hostOrigin ?? 'https://editor.example.com'
    this.mode = options.mode ?? 'register'
    this.sessionId = options.sessionId ?? 'session-1'
    this.parent = options.parent ?? { name: 'shell' }
    this.onPost = options.onPost
  }

  post(message: Envelope): void {
    this.posted.push(message)
    this.onPost?.(message)
  }

  receive(listener: TransportListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Deliver a message to the gate. Defaults to a valid shell origin and parent. */
  emit(message: unknown, meta: Partial<TransportMessageMeta> = {}): void {
    const full: TransportMessageMeta = {
      origin: meta.origin ?? this.hostOrigin,
      source: meta.source ?? this.parent,
    }
    for (const listener of [...this.listeners]) listener(message, full)
  }

  last(type: string): Envelope | undefined {
    return [...this.posted].reverse().find((envelope) => envelope.type === type)
  }
}
