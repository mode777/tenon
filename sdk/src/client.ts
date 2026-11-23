import type { MessageGate } from './gate'
import { parseShellError } from './init'
import { CommandClient } from './command'
import {
  ExoProtocolError,
  MAX_IN_FLIGHT_REQUESTS,
  MAX_LOCAL_EVENT_BYTES,
  MAX_NEW_FILE_BYTES,
  MAX_VIEW_PAYLOAD_BYTES,
  isEventTopic,
  isLocalEventTopic,
  isPlainObject,
  payloadTooLarge,
  type BinaryFileContent,
  type DirectoryPage,
  type DisposeReason,
  type EditorCapabilities,
  type EventPayloads,
  type EventTopic,
  type FileContent,
  type FilePickerOptions,
  type ListDirectoryOptions,
  type LocalEvent,
  type LocalEventTopic,
  type NewFileOptions,
  type NewFileResult,
  type OpenViewOptions,
  type PanelAction,
  type PanelResult,
  type SettingValues,
  type ShellErrorPayload,
  type ShellEvent,
  type ShellInit,
  type TextFileContent,
  type CommandHandler,
} from './protocol'

export type DisposeListener = (reason: DisposeReason) => void
export type ErrorListener = (error: ShellErrorPayload) => void
export type EventListener<T extends EventTopic> = (event: ShellEvent<EventPayloads[T]>) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: ExoProtocolError) => void
}

const DISPOSE_REASONS: DisposeReason[] = ['closed', 'workspace-switch', 'plugin-removed', 'error']

export function errorOf(error: unknown): ExoProtocolError {
  if (error instanceof ExoProtocolError) return error
  return new ExoProtocolError('internal', 'The plugin operation failed.', { cause: error })
}

function parseTextOrBinary(
  payload: unknown,
): { path: string; version: string; text?: string; bytes?: ArrayBuffer } | null {
  if (!isPlainObject(payload)) return null
  if (typeof payload.path !== 'string' || typeof payload.version !== 'string') return null
  if (typeof payload.text === 'string') {
    return { path: payload.path, version: payload.version, text: payload.text }
  }
  if (payload.bytes instanceof ArrayBuffer) {
    return { path: payload.path, version: payload.version, bytes: payload.bytes }
  }
  return null
}

function parseFileSelection(payload: unknown): string[] | null {
  if (!isPlainObject(payload) || !Array.isArray(payload.paths)) return null
  if (payload.paths.some((path) => typeof path !== 'string')) return null
  return payload.paths as string[]
}

function parseNewFileResult(payload: unknown): NewFileResult | null | undefined {
  if (!isPlainObject(payload)) return undefined
  if (payload.cancelled === true) return Object.keys(payload).length === 1 ? null : undefined
  if (typeof payload.path !== 'string' || typeof payload.version !== 'string') return undefined
  if (Object.keys(payload).some((key) => key !== 'path' && key !== 'version')) return undefined
  return { path: payload.path, version: payload.version }
}

function parseDirectoryPage(payload: unknown): DirectoryPage | null {
  if (!isPlainObject(payload) || !Array.isArray(payload.entries)) return null
  if (
    payload.nextCursor !== undefined &&
    (typeof payload.nextCursor !== 'string' || payload.nextCursor.length === 0)
  ) {
    return null
  }
  const entries: DirectoryPage['entries'] = []
  for (const item of payload.entries) {
    if (!isPlainObject(item) || typeof item.path !== 'string' || item.path.length === 0) {
      return null
    }
    const keys = Object.keys(item)
    if (item.kind === 'file') {
      if (keys.some((key) => key !== 'path' && key !== 'kind' && key !== 'size')) return null
      if (typeof item.size !== 'number' || !Number.isFinite(item.size) || item.size < 0) {
        return null
      }
      entries.push({ path: item.path, kind: 'file', size: item.size })
      continue
    }
    if (item.kind === 'directory') {
      if (keys.some((key) => key !== 'path' && key !== 'kind')) return null
      entries.push({ path: item.path, kind: 'directory' })
      continue
    }
    return null
  }
  return {
    entries,
    ...(payload.nextCursor === undefined ? {} : { nextCursor: payload.nextCursor }),
  }
}

function parseEvent(payload: unknown): ShellEvent | null {
  if (!isPlainObject(payload)) return null
  if (typeof payload.topic !== 'string' || typeof payload.seq !== 'number') return null
  if (payload.from !== undefined && typeof payload.from !== 'string') return null
  if (!isEventTopic(payload.topic) && !isLocalEventTopic(payload.topic)) return null
  return {
    topic: payload.topic,
    seq: payload.seq,
    payload: payload.payload,
    ...(payload.from === undefined ? {} : { from: payload.from }),
  }
}

function parsePublished(payload: unknown): { topic: LocalEventTopic; seq: number } | null {
  if (!isPlainObject(payload)) return null
  if (!isLocalEventTopic(payload.topic) || typeof payload.seq !== 'number') return null
  return { topic: payload.topic, seq: payload.seq }
}

function parseNavigationResult(payload: unknown): { ok: true } | null {
  if (!isPlainObject(payload) || payload.ok !== true) return null
  return { ok: true }
}

function parsePanelResult(payload: unknown): PanelResult | null {
  if (!isPlainObject(payload) || typeof payload.panel !== 'string') return null
  if (typeof payload.open !== 'boolean') return null
  return { panel: payload.panel, open: payload.open }
}

/**
 * The handshake result, mediated reads, listings, file picker, events, disposal
 * and navigation helpers shared by editor and view clients. It never parses
 * file content beyond decoding text or returning bytes.
 */
export class FrameClient {
  protected readonly gate: MessageGate
  protected readonly init: ShellInit
  protected readonly pending = new Map<string, PendingRequest>()
  protected readonly subscriptions = new Set<string>()
  protected readonly eventListeners = new Map<string, Set<(event: ShellEvent) => void>>()
  protected readonly disposeListeners = new Set<DisposeListener>()
  protected readonly errorListeners = new Set<ErrorListener>()
  private readonly commandClient: CommandClient
  protected nextRequestId = 0
  protected isClosed = false
  protected disposed = false
  private pendingPickerId: string | null = null
  private pendingNewFileId: string | null = null

  constructor(gate: MessageGate, init: ShellInit) {
    this.gate = gate
    this.init = init
    this.commandClient = new CommandClient(gate)

    gate.on('shell/file-content', (envelope) =>
      this.handleContent(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/files-selected', (envelope) =>
      this.handleFileSelection(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/new-file-result', (envelope) =>
      this.handleNewFileResult(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/list-result', (envelope) =>
      this.handleListing(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/error', (envelope) => this.handleError(envelope.replyTo, envelope.payload))
    gate.on('shell/subscribed', (envelope) =>
      this.handleSubscribed(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/published', (envelope) =>
      this.handlePublished(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/event', (envelope) => this.handleEvent(envelope.payload))
    gate.on('shell/open-result', (envelope) =>
      this.handleNavigationResult(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/panel-result', (envelope) =>
      this.handlePanelResult(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/dispose', (envelope) => this.handleDispose(envelope.payload))
  }

  get initialization(): ShellInit {
    return this.init
  }

  get capabilities(): EditorCapabilities {
    const init = this.init
    if (init.mode === 'register') {
      throw new ExoProtocolError('identity', 'A registration frame has no frame capabilities.')
    }
    return init.capabilities
  }

  get settings(): SettingValues {
    return this.init.settings
  }

  get closed(): boolean {
    return this.isClosed
  }

  /** Whether this shell delivers `shell/command`; absence on an older shell is false. */
  get supportsCommands(): boolean {
    return this.capabilities.commands
  }

  /**
   * Attach the one command handler. Every invocation is answered automatically;
   * a thrown error or `{ ok: false }` becomes a bounded failure result.
   */
  onCommand(handler: CommandHandler): () => void {
    if (this.isClosed) return () => undefined
    return this.commandClient.onCommand(handler)
  }

  readFile(path: string, encoding?: 'utf8'): Promise<TextFileContent>
  readFile(path: string, encoding: 'binary'): Promise<BinaryFileContent>
  readFile(path: string, encoding: 'utf8' | 'binary' = 'utf8'): Promise<FileContent> {
    const id = this.nextId()
    return this.request<FileContent>(id, 'plugin/request-file', { path, encoding })
  }

  /**
   * Ask the shell to open its workspace file picker. Resolves with the selected
   * `/`-rooted paths, or `[]` when the user cancels.
   */
  requestFiles(options: FilePickerOptions = {}): Promise<string[]> {
    if (!this.capabilities.filePicker) {
      return Promise.reject(
        new ExoProtocolError(
          'unsupported-message',
          'This shell does not support the workspace file picker.',
        ),
      )
    }
    if (!this.capabilities.requestFiles) {
      return Promise.reject(
        new ExoProtocolError(
          'permission-denied',
          'The plugin does not have workspace read permission for the picker.',
        ),
      )
    }
    if (this.pendingPickerId !== null) {
      return Promise.reject(
        new ExoProtocolError('rate-limited', 'A file picker request is already pending.'),
      )
    }
    const id = this.nextId()
    this.pendingPickerId = id
    return this.request<string[]>(id, 'plugin/request-files', {
      multiple: options.multiple === true,
      ...(options.directory === undefined ? {} : { directory: options.directory }),
    }).finally(() => {
      if (this.pendingPickerId === id) this.pendingPickerId = null
    })
  }

  /**
   * Ask the shell to create a new file from generated text or bytes. Resolves
   * with the path and version, or `null` when the user cancels.
   */
  requestNewFile(options: NewFileOptions): Promise<NewFileResult | null> {
    if (!this.capabilities.createFile) {
      return Promise.reject(
        new ExoProtocolError(
          'unsupported-message',
          'This shell does not support new-file creation.',
        ),
      )
    }
    if (!this.init.permissions.includes('workspace:write')) {
      return Promise.reject(
        new ExoProtocolError(
          'permission-denied',
          'The plugin does not have workspace:write permission for new-file creation.',
        ),
      )
    }
    if (this.pendingNewFileId !== null) {
      return Promise.reject(
        new ExoProtocolError('rate-limited', 'A new-file request is already pending.'),
      )
    }
    const hasText = typeof options.text === 'string'
    const hasBytes = options.bytes instanceof ArrayBuffer || ArrayBuffer.isView(options.bytes)
    if (hasText === hasBytes) {
      return Promise.reject(
        new ExoProtocolError(
          'protocol-violation',
          'A new-file request needs exactly one of text or bytes.',
        ),
      )
    }
    if (
      options.suggestedName !== undefined &&
      (typeof options.suggestedName !== 'string' || options.suggestedName.length > 128)
    ) {
      return Promise.reject(
        new ExoProtocolError(
          'protocol-violation',
          'A suggested name must be at most 128 characters.',
        ),
      )
    }
    if (options.directory !== undefined && typeof options.directory !== 'string') {
      return Promise.reject(
        new ExoProtocolError('protocol-violation', 'A directory hint must be a string.'),
      )
    }

    let payload: { text: string } | { bytes: ArrayBuffer }
    let size: number
    if (hasText) {
      const text = options.text as string
      payload = { text }
      size = new TextEncoder().encode(text).byteLength
    } else {
      const raw = options.bytes
      let bytes: Uint8Array
      if (raw instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw.slice(0))
      } else {
        const view = raw as ArrayBufferView
        bytes = new Uint8Array(view.byteLength)
        bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
      }
      const buffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buffer).set(bytes)
      payload = { bytes: buffer }
      size = bytes.byteLength
    }
    if (size > MAX_NEW_FILE_BYTES) {
      return Promise.reject(
        new ExoProtocolError(
          'too-large',
          `Generated files are limited to ${MAX_NEW_FILE_BYTES} bytes; this request is ${size} bytes.`,
        ),
      )
    }

    const id = this.nextId()
    this.pendingNewFileId = id
    return this.request<NewFileResult | null>(id, 'plugin/request-new-file', {
      ...payload,
      ...(options.suggestedName === undefined ? {} : { suggestedName: options.suggestedName }),
      ...(options.directory === undefined ? {} : { directory: options.directory }),
    }).finally(() => {
      if (this.pendingNewFileId === id) this.pendingNewFileId = null
    })
  }

  /**
   * List one workspace directory level. Resolves with a page of minimal entries
   * and, when more remain, the opaque `nextCursor` to pass to the next call.
   */
  listDirectory(path: string, options: ListDirectoryOptions = {}): Promise<DirectoryPage> {
    if (!this.capabilities.directoryListing) {
      return Promise.reject(
        new ExoProtocolError(
          'unsupported-message',
          'This shell does not support directory listing.',
        ),
      )
    }
    if (!this.init.permissions.includes('workspace:list')) {
      return Promise.reject(
        new ExoProtocolError(
          'permission-denied',
          'The plugin does not have workspace:list permission.',
        ),
      )
    }
    const id = this.nextId()
    return this.request<DirectoryPage>(id, 'plugin/request-list', {
      path,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    })
  }

  /** Ask the shell to open a workspace file or focus its tab. */
  openFile(path: string): Promise<{ ok: true }> {
    if (!this.capabilities.openFile) {
      return Promise.reject(
        new ExoProtocolError('unsupported-message', 'This shell does not support open-file.'),
      )
    }
    if (!this.init.permissions.includes('workspace:read')) {
      return Promise.reject(
        new ExoProtocolError('permission-denied', 'The plugin does not have workspace:read.'),
      )
    }
    if (this.init.mode === 'view' && !path.startsWith('/')) {
      return Promise.reject(
        new ExoProtocolError(
          'permission-denied',
          'A view must ask to open a /-rooted workspace path.',
        ),
      )
    }
    const id = this.nextId()
    return this.request<{ ok: true }>(id, 'plugin/open-file', { path })
  }

  /** Ask the shell to open or focus a registered content view. */
  openView(options: OpenViewOptions): Promise<{ ok: true }> {
    if (!this.capabilities.openView) {
      return Promise.reject(
        new ExoProtocolError('unsupported-message', 'This shell does not support open-view.'),
      )
    }
    if (
      typeof options.viewId !== 'string' ||
      options.viewId.length === 0 ||
      options.viewId.length > 64
    ) {
      return Promise.reject(
        new ExoProtocolError('protocol-violation', 'A view id must be 1-64 characters.'),
      )
    }
    if (
      options.pluginId !== undefined &&
      (typeof options.pluginId !== 'string' ||
        options.pluginId.length === 0 ||
        options.pluginId.length > 80)
    ) {
      return Promise.reject(
        new ExoProtocolError('protocol-violation', 'A plugin id must be 1-80 characters.'),
      )
    }
    if (
      options.instanceKey !== undefined &&
      (typeof options.instanceKey !== 'string' || options.instanceKey.length > 64)
    ) {
      return Promise.reject(
        new ExoProtocolError(
          'protocol-violation',
          'An instance key must be at most 64 characters.',
        ),
      )
    }
    if (options.payload !== undefined && payloadTooLarge(options.payload, MAX_VIEW_PAYLOAD_BYTES)) {
      return Promise.reject(
        new ExoProtocolError(
          'too-large',
          `Content-view payloads are limited to ${MAX_VIEW_PAYLOAD_BYTES} bytes.`,
        ),
      )
    }
    const id = this.nextId()
    return this.request<{ ok: true }>(id, 'plugin/open-view', {
      viewId: options.viewId,
      ...(options.pluginId === undefined ? {} : { pluginId: options.pluginId }),
      ...(options.instanceKey === undefined ? {} : { instanceKey: options.instanceKey }),
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    })
  }

  /** Ask the shell to show, hide or toggle one of this plugin's panels. */
  requestPanel(panel: string, action: PanelAction): Promise<PanelResult> {
    if (!this.capabilities.requestPanel) {
      return Promise.reject(
        new ExoProtocolError('unsupported-message', 'This shell does not support request-panel.'),
      )
    }
    if (typeof panel !== 'string' || panel.length === 0 || panel.length > 64) {
      return Promise.reject(
        new ExoProtocolError('protocol-violation', 'A panel id must be 1-64 characters.'),
      )
    }
    if (action !== 'show' && action !== 'hide' && action !== 'toggle') {
      return Promise.reject(
        new ExoProtocolError('protocol-violation', 'A panel action must show, hide or toggle.'),
      )
    }
    const id = this.nextId()
    return this.request<PanelResult>(id, 'plugin/request-panel', { panel, action })
  }

  onDispose(listener: DisposeListener): () => void {
    this.disposeListeners.add(listener)
    return () => {
      this.disposeListeners.delete(listener)
    }
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  subscribe(topic: EventTopic): Promise<{ topic: EventTopic; seq: number }> {
    const id = this.nextId()
    return this.request<{ topic: EventTopic; seq: number }>(id, 'plugin/subscribe', { topic }).then(
      (result) => {
        this.subscriptions.add(result.topic)
        return result
      },
    )
  }

  unsubscribe(topic: EventTopic | LocalEventTopic): void {
    if (this.isClosed) return
    this.subscriptions.delete(topic)
    this.eventListeners.delete(topic)
    this.gate.send('plugin/unsubscribe', { topic })
  }

  /** Publish a plugin-local event to the other frames of this plugin. */
  publishLocal(
    topic: LocalEventTopic | EventTopic,
    payload: unknown,
  ): Promise<{ topic: LocalEventTopic; seq: number }> {
    const preflight = this.localPreflight(topic)
    if (preflight) return Promise.reject(preflight)
    if (payloadTooLarge(payload, MAX_LOCAL_EVENT_BYTES)) {
      return Promise.reject(
        new ExoProtocolError(
          'too-large',
          `Local event payloads are limited to ${MAX_LOCAL_EVENT_BYTES} bytes.`,
        ),
      )
    }
    const id = this.nextId()
    return this.request<{ topic: LocalEventTopic; seq: number }>(id, 'plugin/publish', {
      topic,
      payload,
    })
  }

  /** Subscribe to a plugin-local topic; no history is replayed. */
  subscribeLocal(
    topic: LocalEventTopic | EventTopic,
  ): Promise<{ topic: LocalEventTopic; seq: number }> {
    const preflight = this.localPreflight(topic)
    if (preflight) return Promise.reject(preflight)
    const id = this.nextId()
    return this.request<{ topic: string; seq: number }>(id, 'plugin/subscribe', { topic }).then(
      (result) => {
        this.subscriptions.add(topic)
        return { topic: topic as LocalEventTopic, seq: result.seq }
      },
    )
  }

  /** Receive local events after `subscribeLocal`; the payload is not interpreted. */
  onLocalEvent<T = unknown>(
    topic: LocalEventTopic,
    listener: (event: LocalEvent<T>) => void,
  ): () => void {
    let set = this.eventListeners.get(topic)
    if (!set) {
      set = new Set()
      this.eventListeners.set(topic, set)
    }
    const wrapped = listener as unknown as (event: ShellEvent) => void
    set.add(wrapped)
    return () => {
      const current = this.eventListeners.get(topic)
      current?.delete(wrapped)
    }
  }

  onEvent<T extends EventTopic>(topic: T, listener: EventListener<T>): () => void {
    let set = this.eventListeners.get(topic)
    if (!set) {
      set = new Set()
      this.eventListeners.set(topic, set)
    }
    const wrapped = listener as (event: ShellEvent) => void
    set.add(wrapped)
    return () => {
      const current = this.eventListeners.get(topic)
      current?.delete(wrapped)
    }
  }

  close(): void {
    if (this.isClosed) return
    this.isClosed = true
    this.rejectPending()
    this.commandClient.dispose()
    this.gate.close()
  }

  protected localPreflight(topic: string): ExoProtocolError | null {
    if (!this.capabilities.localEvents) {
      return new ExoProtocolError(
        'unsupported-message',
        'This shell does not support plugin-local events.',
      )
    }
    if (!this.init.permissions.includes('events:subscribe')) {
      return new ExoProtocolError(
        'permission-denied',
        'The plugin does not have events:subscribe permission for local topics.',
      )
    }
    if (isEventTopic(topic)) {
      return new ExoProtocolError(
        'permission-denied',
        'Plugins cannot publish or subscribe to shell topics through the local API.',
      )
    }
    if (!isLocalEventTopic(topic)) {
      return new ExoProtocolError(
        'unsupported-topic',
        'A local topic must be local/<name> with a lowercase 1-64 character name.',
      )
    }
    return null
  }

  protected nextId(): string {
    this.nextRequestId += 1
    return `exo-${this.nextRequestId}`
  }

  protected request<T>(id: string, type: string, payload: unknown): Promise<T> {
    if (this.isClosed) {
      return Promise.reject(new ExoProtocolError('closed', 'The plugin frame is closed.'))
    }
    if (this.pending.size >= MAX_IN_FLIGHT_REQUESTS) {
      return Promise.reject(
        new ExoProtocolError('rate-limited', 'Too many in-flight plugin requests (maximum 64).'),
      )
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      try {
        this.gate.send(type, payload, { id })
      } catch (error) {
        this.pending.delete(id)
        reject(errorOf(error))
      }
    })
  }

  protected settle(id: string | undefined, error?: ExoProtocolError, value?: unknown): void {
    if (!id) return
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if (error) pending.reject(error)
    else pending.resolve(value)
  }

  protected rejectPending(): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const item of pending) {
      item.reject(new ExoProtocolError('closed', 'The plugin frame was disposed.'))
    }
  }

  private handleContent(replyTo: string | undefined, payload: unknown): void {
    const content = parseTextOrBinary(payload)
    if (!content) {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent invalid file content.'),
      )
      return
    }
    this.settle(replyTo, undefined, content)
  }

  private handleFileSelection(replyTo: string | undefined, payload: unknown): void {
    const paths = parseFileSelection(payload)
    if (!paths) {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent an invalid file selection.'),
      )
      return
    }
    this.settle(replyTo, undefined, paths)
  }

  private handleNewFileResult(replyTo: string | undefined, payload: unknown): void {
    const result = parseNewFileResult(payload)
    if (result === undefined) {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent an invalid new-file result.'),
      )
      return
    }
    this.settle(replyTo, undefined, result)
  }

  private handleListing(replyTo: string | undefined, payload: unknown): void {
    const page = parseDirectoryPage(payload)
    if (!page) {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent an invalid directory page.'),
      )
      return
    }
    this.settle(replyTo, undefined, page)
  }

  private handleNavigationResult(replyTo: string | undefined, payload: unknown): void {
    const result = parseNavigationResult(payload)
    if (!result) {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent an invalid open result.'),
      )
      return
    }
    this.settle(replyTo, undefined, result)
  }

  private handlePanelResult(replyTo: string | undefined, payload: unknown): void {
    const result = parsePanelResult(payload)
    if (!result) {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent an invalid panel result.'),
      )
      return
    }
    this.settle(replyTo, undefined, result)
  }

  private handleError(replyTo: string | undefined, payload: unknown): void {
    const error = parseShellError(payload)
    if (replyTo) {
      if (!error) {
        this.settle(
          replyTo,
          new ExoProtocolError('protocol-violation', 'The shell sent an invalid error payload.'),
        )
        return
      }
      this.settle(
        replyTo,
        new ExoProtocolError(error.code, error.message ?? `The shell returned ${error.code}.`),
      )
      return
    }
    if (error) this.emitError(error)
  }

  private emitError(error: ShellErrorPayload): void {
    for (const listener of [...this.errorListeners]) {
      try {
        listener(error)
      } catch {
        // A listener must not break protocol dispatch.
      }
    }
  }

  private handleSubscribed(replyTo: string | undefined, payload: unknown): void {
    if (!isPlainObject(payload) || typeof payload.topic !== 'string') {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent an invalid subscription reply.'),
      )
      return
    }
    if (payload.code === 'unsupported-topic') {
      this.settle(
        replyTo,
        new ExoProtocolError('unsupported-topic', `The shell does not support ${payload.topic}.`),
      )
      return
    }
    if (typeof payload.seq !== 'number') {
      this.settle(
        replyTo,
        new ExoProtocolError(
          'protocol-violation',
          'The shell sent an invalid subscription sequence.',
        ),
      )
      return
    }
    this.settle(replyTo, undefined, { topic: payload.topic as EventTopic, seq: payload.seq })
  }

  private handlePublished(replyTo: string | undefined, payload: unknown): void {
    const published = parsePublished(payload)
    if (!published) {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent an invalid publish reply.'),
      )
      return
    }
    this.settle(replyTo, undefined, published)
  }

  private handleEvent(payload: unknown): void {
    const event = parseEvent(payload)
    if (!event) return
    const listeners = this.eventListeners.get(event.topic)
    if (listeners) {
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch {
          // One plugin listener must not stop later event delivery.
        }
      }
    }
  }

  private handleDispose(payload: unknown): void {
    if (this.isClosed) return
    const reason =
      isPlainObject(payload) &&
      typeof payload.reason === 'string' &&
      DISPOSE_REASONS.includes(payload.reason as DisposeReason)
        ? (payload.reason as DisposeReason)
        : 'closed'
    if (!this.disposed) {
      this.disposed = true
      try {
        this.gate.send('plugin/dispose-ack', {})
      } catch {
        // The frame may already be gone; disposal is still local and idempotent.
      }
    }
    this.isClosed = true
    this.rejectPending()
    this.commandClient.dispose()
    for (const listener of [...this.disposeListeners]) {
      try {
        listener(reason)
      } catch {
        // A listener must not break disposal.
      }
    }
    this.gate.close()
  }
}
