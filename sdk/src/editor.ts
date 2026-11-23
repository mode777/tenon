import type { MessageGate } from './gate'
import { FrameClient } from './client'
import {
  ExoProtocolError,
  isPlainObject,
  type EditorInit,
  type EditorLimits,
  type FileChangedPayload,
  type FileMetadata,
  type SaveContent,
  type SaveResult,
  type ShellErrorCode,
} from './protocol'

export type SaveHandler = (request: { id: string }) => SaveContent | Promise<SaveContent>
export type SaveResultListener = (result: SaveResult) => void
export type FileChangedListener = (change: FileChangedPayload) => void

const FILE_CHANGE_KINDS: FileChangedPayload['kind'][] = ['created', 'changed', 'deleted', 'renamed']

function isSaveContent(value: unknown): value is SaveContent {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  if (typeof value.text === 'string') return true
  return value.bytes instanceof ArrayBuffer
}

function parseSaveResult(payload: unknown): SaveResult | null {
  if (!isPlainObject(payload)) return null
  if (payload.ok === true) {
    if (typeof payload.version !== 'string') return null
    return { ok: true, version: payload.version }
  }
  if (payload.ok !== false) return null
  if (typeof payload.code !== 'string') return null
  if (payload.message !== undefined && typeof payload.message !== 'string') return null
  return {
    ok: false,
    code: payload.code as ShellErrorCode,
    ...(payload.message === undefined ? {} : { message: payload.message }),
  }
}

function parseFileChanged(payload: unknown): FileChangedPayload | null {
  if (!isPlainObject(payload)) return null
  if (typeof payload.path !== 'string') return null
  if (
    typeof payload.kind !== 'string' ||
    !FILE_CHANGE_KINDS.includes(payload.kind as FileChangedPayload['kind'])
  ) {
    return null
  }
  if (payload.version !== undefined && typeof payload.version !== 'string') return null
  return {
    path: payload.path,
    kind: payload.kind as FileChangedPayload['kind'],
    ...(payload.version === undefined ? {} : { version: payload.version }),
  }
}

/** One editor frame's protocol client. It never parses file content. */
export class EditorClient extends FrameClient {
  private readonly editorInit: EditorInit
  private readonly saveResultListeners = new Set<SaveResultListener>()
  private readonly fileChangedListeners = new Set<FileChangedListener>()
  private readonly saveHandlers: SaveHandler[] = []
  private metadata: FileMetadata
  private liveSaveId: string | null = null

  constructor(gate: MessageGate, init: EditorInit) {
    if ((init as { mode?: string }).mode !== 'editor') {
      throw new ExoProtocolError(
        'identity',
        'An editor client requires an editor-mode initialization.',
      )
    }
    super(gate, init)
    this.editorInit = init
    this.metadata = { ...init.file }

    gate.on('shell/request-save', (envelope) => {
      void this.handleSaveRequest(envelope.id)
    })
    gate.on('shell/save-result', (envelope) =>
      this.handleSaveResult(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/file-changed', (envelope) => this.handleFileChanged(envelope.payload))
  }

  get initialization(): EditorInit {
    return this.editorInit
  }

  get file(): FileMetadata {
    return this.metadata
  }

  get capabilities() {
    return this.editorInit.capabilities
  }

  get limits(): EditorLimits {
    return this.editorInit.limits
  }

  setDirty(dirty: boolean): void {
    if (this.closed) return
    this.gate.send('plugin/dirty', { dirty })
  }

  /**
   * Ask the shell to run its normal save action for the bound document. This is
   * an id-less intent: content still arrives only in reply to the shell's
   * `shell/request-save`, and the outcome arrives through `onSaveResult`.
   */
  requestSave(): void {
    if (this.closed) return
    this.gate.send('plugin/request-save')
  }

  onSaveRequest(handler: SaveHandler): () => void {
    this.saveHandlers.push(handler)
    return () => {
      const index = this.saveHandlers.lastIndexOf(handler)
      if (index >= 0) this.saveHandlers.splice(index, 1)
    }
  }

  onSaveResult(listener: SaveResultListener): () => void {
    this.saveResultListeners.add(listener)
    return () => {
      this.saveResultListeners.delete(listener)
    }
  }

  onFileChanged(listener: FileChangedListener): () => void {
    this.fileChangedListeners.add(listener)
    return () => {
      this.fileChangedListeners.delete(listener)
    }
  }

  private async handleSaveRequest(id: string | undefined): Promise<void> {
    const handler = this.saveHandlers.at(-1)
    if (this.closed || !id || !handler) return
    try {
      const content = await handler({ id })
      if (this.closed || !isSaveContent(content)) return
      this.liveSaveId = id
      this.gate.send('plugin/save-content', content, { replyTo: id })
    } catch {
      // The protocol has no save-cancel message; the shell's timeout is the
      // defined outcome and the document stays dirty.
    }
  }

  private handleSaveResult(replyTo: string | undefined, payload: unknown): void {
    const result = parseSaveResult(payload)
    if (!result) return
    if (this.liveSaveId !== null && replyTo !== this.liveSaveId) return
    this.liveSaveId = null
    if (result.ok) this.metadata = { ...this.metadata, version: result.version }
    for (const listener of [...this.saveResultListeners]) {
      try {
        listener(result)
      } catch {
        // Contained for the same reason as event listeners.
      }
    }
  }

  private handleFileChanged(payload: unknown): void {
    const change = parseFileChanged(payload)
    if (!change) return
    for (const listener of [...this.fileChangedListeners]) {
      try {
        listener(change)
      } catch {
        // A listener must not break later notifications.
      }
    }
  }
}
