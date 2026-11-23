import { MessageGate } from './gate'
import { parseShellError, parseShellInit } from './init'
import {
  ExoProtocolError,
  PROTOCOL_VERSION,
  READY_TIMEOUT_MS,
  type RegistrationInit,
  type ShellInit,
  type ViewInit,
} from './protocol'
import { RegistrationClient } from './registration'
import { EditorClient } from './editor'
import { ViewClient } from './view'
import type { PluginTransport } from './transport'

export interface ConnectOptions {
  transport: PluginTransport
  /** Diagnostic override for compatibility checks; defaults to the SDK protocol. */
  protocolVersion?: string
  timeoutMs?: number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

export interface RegistrationConnection {
  mode: 'register'
  init: RegistrationInit
  registration: RegistrationClient
  close(): void
}

export interface EditorConnection {
  mode: 'editor'
  init: Extract<ShellInit, { mode: 'editor' }>
  editor: EditorClient
  close(): void
}

export interface ViewConnection {
  mode: 'view'
  init: ViewInit
  view: ViewClient
  close(): void
}

export type PluginConnection = RegistrationConnection | EditorConnection | ViewConnection

function buildConnection(
  gate: MessageGate,
  init: ShellInit,
  options: ConnectOptions,
): PluginConnection {
  if (init.mode === 'register') {
    return {
      mode: 'register',
      init,
      registration: new RegistrationClient(gate, init, {
        ...(options.setTimeoutImpl === undefined ? {} : { setTimeoutImpl: options.setTimeoutImpl }),
        ...(options.clearTimeoutImpl === undefined
          ? {}
          : { clearTimeoutImpl: options.clearTimeoutImpl }),
      }),
      close: () => gate.close(),
    }
  }
  if (init.mode === 'view') {
    return {
      mode: 'view',
      init,
      view: new ViewClient(gate, init),
      close: () => gate.close(),
    }
  }
  return {
    mode: 'editor',
    init,
    editor: new EditorClient(gate, init),
    close: () => gate.close(),
  }
}

/**
 * Perform the plugin/ready -> shell/init handshake and return the typed client
 * for the fragment's mode. The gate is closed on every failure, so a rejected
 * connection cannot keep dispatching.
 */
export function connectPlugin(options: ConnectOptions): Promise<PluginConnection> {
  const { transport } = options
  const requested = options.protocolVersion ?? PROTOCOL_VERSION
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS
  const setTimeoutImpl =
    options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
  const clearTimeoutImpl =
    options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)

  return new Promise<PluginConnection>((resolve, reject) => {
    if (!transport.hostOrigin) {
      reject(new ExoProtocolError('bootstrap', 'The plugin has no host origin.'))
      return
    }
    if (!transport.sessionId) {
      reject(new ExoProtocolError('bootstrap', 'The plugin has no frame session id.'))
      return
    }
    if (transport.mode !== 'register' && transport.mode !== 'editor' && transport.mode !== 'view') {
      reject(new ExoProtocolError('bootstrap', 'The plugin has no valid frame mode.'))
      return
    }

    const gate = new MessageGate(transport)
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let offInit: (() => void) | null = null
    let offError: (() => void) | null = null

    const cleanup = () => {
      if (timer !== null) {
        clearTimeoutImpl(timer)
        timer = null
      }
      offInit?.()
      offError?.()
    }
    const fail = (error: ExoProtocolError) => {
      if (settled) return
      settled = true
      cleanup()
      gate.close()
      reject(error)
    }
    const succeed = (init: ShellInit) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(buildConnection(gate, init, options))
    }

    timer = setTimeoutImpl(() => {
      fail(
        new ExoProtocolError(
          'timeout',
          `The shell did not initialize the ${transport.mode} frame within ${timeoutMs} ms.`,
        ),
      )
    }, timeoutMs)

    offInit = gate.on('shell/init', (envelope) => {
      try {
        succeed(parseShellInit(envelope.payload, transport, requested))
      } catch (error) {
        fail(
          error instanceof ExoProtocolError
            ? error
            : new ExoProtocolError('protocol-violation', 'The shell initialization is invalid.', {
                cause: error,
              }),
        )
      }
    })

    offError = gate.on('shell/error', (envelope) => {
      if (envelope.replyTo) return
      const payload = parseShellError(envelope.payload)
      if (!payload) {
        fail(new ExoProtocolError('protocol-violation', 'The shell sent an invalid error payload.'))
        return
      }
      if (payload.code === 'unsupported-version') {
        fail(
          new ExoProtocolError(
            'unsupported-version',
            `The shell rejected protocol version ${requested}; this SDK speaks ${PROTOCOL_VERSION}.`,
            { expected: PROTOCOL_VERSION, received: requested },
          ),
        )
        return
      }
      fail(
        new ExoProtocolError(
          payload.code,
          payload.message ?? `The shell rejected the plugin with ${payload.code}.`,
        ),
      )
    })

    try {
      gate.send('plugin/ready', { protocolVersion: requested, sessionId: transport.sessionId })
    } catch (error) {
      fail(
        error instanceof ExoProtocolError
          ? error
          : new ExoProtocolError('internal', 'The plugin could not send plugin/ready.', {
              cause: error,
            }),
      )
    }
  })
}
