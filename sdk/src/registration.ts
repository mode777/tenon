import type { MessageGate } from './gate'
import {
  ExoProtocolError,
  REGISTRATION_TIMEOUT_MS,
  isPlainObject,
  type FileEditorContribution,
  type RegistrationAck,
  type RegistrationInit,
  type RejectedContribution,
  type RegistrationRejectionReason,
} from './protocol'
import { parseShellError } from './init'

const REJECTION_REASONS: RegistrationRejectionReason[] = [
  'not-declared',
  'permission-denied',
  'invalid-glob',
  'invalid-contribution',
  'target-not-registered',
]

function parseStringList(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null
  return value as string[]
}

function parseAck(payload: unknown): RegistrationAck | null {
  if (!isPlainObject(payload)) return null
  if (
    !Array.isArray(payload.accepted) ||
    payload.accepted.some((item) => typeof item !== 'string')
  ) {
    return null
  }
  const acceptedPanels = parseStringList(payload.acceptedPanels)
  const acceptedContentViews = parseStringList(payload.acceptedContentViews)
  const acceptedCommands = parseStringList(payload.acceptedCommands)
  const acceptedNewFiles = parseStringList(payload.acceptedNewFiles)
  if (!acceptedPanels || !acceptedContentViews || !acceptedCommands || !acceptedNewFiles)
    return null
  if (!Array.isArray(payload.rejected)) return null
  const rejected: RejectedContribution[] = []
  for (const item of payload.rejected) {
    if (!isPlainObject(item)) return null
    if (typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0) {
      return null
    }
    if (
      typeof item.reason !== 'string' ||
      !REJECTION_REASONS.includes(item.reason as RegistrationRejectionReason)
    ) {
      return null
    }
    if (item.message !== undefined && typeof item.message !== 'string') return null
    if (
      item.kind !== undefined &&
      item.kind !== 'fileEditor' &&
      item.kind !== 'panel' &&
      item.kind !== 'contentView' &&
      item.kind !== 'command' &&
      item.kind !== 'newFile'
    ) {
      return null
    }
    rejected.push({
      index: item.index,
      reason: item.reason as RegistrationRejectionReason,
      ...(item.kind === undefined
        ? {}
        : { kind: item.kind as 'fileEditor' | 'panel' | 'contentView' | 'command' | 'newFile' }),
      ...(item.message === undefined ? {} : { message: item.message }),
    })
  }
  return {
    accepted: payload.accepted as string[],
    acceptedPanels,
    acceptedContentViews,
    acceptedCommands,
    acceptedNewFiles,
    rejected,
  }
}

export interface RegistrationClientOptions {
  timeoutMs?: number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

/** The controller-side registration phase. The shell removes the frame after the ack. */
export class RegistrationClient {
  private readonly gate: MessageGate
  private readonly init: RegistrationInit
  private readonly timeoutMs: number
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout
  private completed = false
  private completing = false

  constructor(gate: MessageGate, init: RegistrationInit, options: RegistrationClientOptions = {}) {
    if ((init as { mode?: string }).mode !== 'register') {
      throw new ExoProtocolError(
        'identity',
        'A registration client requires a register-mode initialization.',
      )
    }
    this.gate = gate
    this.init = init
    this.timeoutMs = options.timeoutMs ?? REGISTRATION_TIMEOUT_MS
    this.setTimeoutImpl =
      options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)
  }

  get initialization(): RegistrationInit {
    return this.init
  }

  get isComplete(): boolean {
    return this.completed
  }

  register(contribution: FileEditorContribution): void {
    if (this.completed || this.completing) {
      throw new ExoProtocolError(
        'protocol-violation',
        'Registration is already complete; contributions cannot be added.',
      )
    }
    if (
      typeof contribution.glob !== 'string' ||
      contribution.glob.length === 0 ||
      typeof contribution.entry !== 'string' ||
      contribution.entry.length === 0 ||
      (contribution.label !== undefined && typeof contribution.label !== 'string')
    ) {
      throw new ExoProtocolError('protocol-violation', 'A registration needs a glob and an entry.')
    }
    const payload: FileEditorContribution = {
      glob: contribution.glob,
      entry: contribution.entry,
      ...(contribution.label === undefined ? {} : { label: contribution.label }),
    }
    this.gate.send('plugin/register', { fileEditors: [payload] })
  }

  /** Register a declared panel id; the host mounts it lazily on first reveal. */
  registerPanel(id: string): void {
    this.sendViewRegistration('panels', id)
  }

  /** Register a declared content-view id; the host opens it as a tab. */
  registerContentView(id: string): void {
    this.sendViewRegistration('contentViews', id)
  }

  /** Register a declared command id; it activates after completion. */
  registerCommand(id: string): void {
    this.sendViewRegistration('commands', id)
  }

  /** Register a declared new-file template id; it activates after completion. */
  registerNewFile(id: string): void {
    if (!this.init.capabilities.newFiles) {
      throw new ExoProtocolError(
        'unsupported-message',
        'This shell does not support new-file template registration.',
      )
    }
    this.sendViewRegistration('newFiles', id)
  }

  private sendViewRegistration(
    kind: 'panels' | 'contentViews' | 'commands' | 'newFiles',
    id: string,
  ): void {
    if (this.completed || this.completing) {
      throw new ExoProtocolError(
        'protocol-violation',
        'Registration is already complete; contributions cannot be added.',
      )
    }
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
      throw new ExoProtocolError('protocol-violation', 'A view id must be 1-64 characters.')
    }
    this.gate.send('plugin/register', { [kind]: [id] })
  }

  complete(): Promise<RegistrationAck> {
    if (this.completed) {
      return Promise.reject(
        new ExoProtocolError('protocol-violation', 'Registration has already been completed.'),
      )
    }
    if (this.completing) {
      return Promise.reject(
        new ExoProtocolError('protocol-violation', 'Registration completion is already in flight.'),
      )
    }
    this.completing = true
    return new Promise<RegistrationAck>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      let offAck: (() => void) | null = null
      let offError: (() => void) | null = null

      const cleanup = () => {
        if (timer !== null) {
          this.clearTimeoutImpl(timer)
          timer = null
        }
        offAck?.()
        offError?.()
      }
      const finish = (ack: RegistrationAck) => {
        if (settled) return
        settled = true
        cleanup()
        this.completed = true
        this.completing = false
        resolve(ack)
      }
      const fail = (error: ExoProtocolError) => {
        if (settled) return
        settled = true
        cleanup()
        this.completing = false
        reject(error)
      }

      timer = this.setTimeoutImpl(() => {
        fail(
          new ExoProtocolError(
            'timeout',
            `The shell did not acknowledge registration within ${this.timeoutMs} ms.`,
          ),
        )
      }, this.timeoutMs)

      offAck = this.gate.on('shell/register-ack', (envelope) => {
        const ack = parseAck(envelope.payload)
        if (!ack) {
          fail(
            new ExoProtocolError(
              'protocol-violation',
              'The registration acknowledgement is invalid.',
            ),
          )
          return
        }
        finish(ack)
      })
      offError = this.gate.on('shell/error', (envelope) => {
        if (envelope.replyTo) return
        const payload = parseShellError(envelope.payload)
        if (!payload) {
          fail(new ExoProtocolError('protocol-violation', 'The shell returned an invalid error.'))
          return
        }
        fail(
          new ExoProtocolError(
            payload.code,
            payload.message ?? `Registration failed: ${payload.code}.`,
          ),
        )
      })

      this.gate.send('plugin/register-complete', {})
    })
  }
}
