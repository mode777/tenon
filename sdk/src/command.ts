import type { MessageGate } from './gate'
import {
  isPlainObject,
  type CommandHandler,
  type CommandInvocation,
  type CommandResult,
} from './protocol'

export const MAX_EARLY_COMMANDS = 10
export const MAX_COMMAND_MESSAGE = 200

interface QueuedCommand {
  id: string
  invocation: CommandInvocation
}

function bounded(message: string): string {
  return message.length > MAX_COMMAND_MESSAGE ? message.slice(0, MAX_COMMAND_MESSAGE) : message
}

/** Parse the shell's `shell/command` payload; unknown fields are rejected. */
export function parseCommandInvocation(payload: unknown): CommandInvocation | null {
  if (!isPlainObject(payload)) return null
  if (
    Object.keys(payload).some((key) => key !== 'command' && key !== 'args') ||
    typeof payload.command !== 'string' ||
    payload.command.length === 0 ||
    payload.command.length > 64
  ) {
    return null
  }
  if (payload.args === undefined) return { command: payload.command }
  if (!isPlainObject(payload.args)) return null
  if (
    Object.keys(payload.args).some((key) => key !== 'path' && key !== 'kind') ||
    typeof payload.args.path !== 'string' ||
    (payload.args.kind !== 'file' && payload.args.kind !== 'directory')
  ) {
    return null
  }
  return {
    command: payload.command,
    args: { path: payload.args.path, kind: payload.args.kind },
  }
}

/**
 * Shared command handler for editor and view frames. It answers exactly one
 * `plugin/command-result` per invocation, queues up to ten messages that arrive
 * before a handler is attached, and stops answering after disposal.
 */
export class CommandClient {
  private readonly gate: MessageGate
  private handler: CommandHandler | null = null
  private readonly queue: QueuedCommand[] = []
  private disposed = false

  constructor(gate: MessageGate) {
    this.gate = gate
    gate.on('shell/command', (envelope) => this.handle(envelope.id, envelope.payload))
  }

  onCommand(handler: CommandHandler): () => void {
    this.handler = handler
    this.flush()
    return () => {
      if (this.handler === handler) this.handler = null
    }
  }

  dispose(): void {
    this.disposed = true
    this.queue.length = 0
    this.handler = null
  }

  private handle(id: string | undefined, payload: unknown): void {
    if (this.disposed || !id) return
    const invocation = parseCommandInvocation(payload)
    if (!invocation) {
      this.answer(id, { ok: false, message: 'The plugin received an invalid command payload.' })
      return
    }
    if (!this.handler) {
      if (this.queue.length >= MAX_EARLY_COMMANDS) {
        this.answer(id, {
          ok: false,
          message: 'The plugin has no command handler attached.',
        })
        return
      }
      this.queue.push({ id, invocation })
      return
    }
    void this.dispatch(id, invocation)
  }

  private flush(): void {
    const queued = this.queue.splice(0)
    for (const entry of queued) {
      if (this.disposed) return
      void this.dispatch(entry.id, entry.invocation)
    }
  }

  private async dispatch(id: string, invocation: CommandInvocation): Promise<void> {
    const handler = this.handler
    if (!handler) return
    try {
      const result = await handler(invocation)
      if (this.disposed) return
      if (result && isPlainObject(result) && result.ok === false) {
        this.answer(id, {
          ok: false,
          message: bounded(
            typeof result.message === 'string' && result.message.length > 0
              ? result.message
              : 'The command failed.',
          ),
        })
        return
      }
      this.answer(id, { ok: true })
    } catch (error) {
      if (this.disposed) return
      const message =
        error instanceof Error && error.message.length > 0 ? error.message : 'The command failed.'
      this.answer(id, { ok: false, message: bounded(message) })
    }
  }

  private answer(id: string, result: CommandResult): void {
    try {
      this.gate.send('plugin/command-result', result, { replyTo: id })
    } catch {
      // The frame may already be gone; the shell's timeout is the fallback.
    }
  }
}
