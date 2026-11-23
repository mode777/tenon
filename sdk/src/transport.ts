import type { Envelope, PluginMode } from './protocol'

export interface TransportMessageMeta {
  /** The sender's origin as serialized by the browser. */
  origin: string
  /** The sender window; the gate requires this to be the parent. */
  source: unknown
}

export type TransportListener = (message: unknown, meta: TransportMessageMeta) => void

/**
 * The only seam between the protocol clients and a window. The browser adapter
 * fills it from `location.hash` and `window.parent`; tests inject a fake.
 */
export interface PluginTransport {
  readonly hostOrigin: string
  readonly mode: PluginMode
  readonly sessionId: string
  readonly parent: unknown
  post(message: Envelope): void
  receive(listener: TransportListener): () => void
}
