/**
 * Protocol constants, types and envelope helpers for the plugin side of the
 * Exo v1 protocol. This module never touches the DOM; the browser adapter is
 * the only place that reads `window`, `location` or `parent`.
 */

export const PROTOCOL_VERSION = '1'
export const SDK_VERSION = '1.8.0'

export const READY_TIMEOUT_MS = 10_000
export const REGISTRATION_TIMEOUT_MS = 10_000
export const MAX_IN_FLIGHT_REQUESTS = 64
export const MAX_ID_LENGTH = 64
export const MAX_LOCAL_EVENT_BYTES = 1024 * 1024
export const MAX_VIEW_PAYLOAD_BYTES = 64 * 1024
export const MAX_NEW_FILE_BYTES = 8 * 1024 * 1024

const LOCAL_TOPIC_PATTERN = /^local\/[a-z0-9][a-z0-9._-]{0,63}$/

export type PluginMode = 'register' | 'editor' | 'view'
export type ThemeName = 'dark' | 'light' | 'high-contrast'
export type PluginPermission =
  'workspace:read' | 'workspace:write' | 'workspace:list' | 'events:subscribe'

export interface Envelope<T = unknown> {
  exo: 1
  type: string
  id?: string
  replyTo?: string
  payload?: T
}

export type ShellErrorCode =
  | 'unsupported-message'
  | 'unsupported-version'
  | 'protocol-violation'
  | 'timeout'
  | 'loading-failed'
  | 'permission-denied'
  | 'not-found'
  | 'not-a-file'
  | 'not-a-directory'
  | 'already-exists'
  | 'too-large'
  | 'conflict'
  | 'rate-limited'
  | 'unsupported-topic'
  | 'internal'

export type SdkErrorCode = ShellErrorCode | 'bootstrap' | 'identity' | 'closed'

export interface ExoProtocolErrorDetails {
  expected?: string
  received?: string
  cause?: unknown
}

/** A stable, inspectable error raised by the SDK before or instead of a reply. */
export class ExoProtocolError extends Error {
  readonly code: SdkErrorCode
  readonly expected?: string
  readonly received?: string

  constructor(code: SdkErrorCode, message: string, details: ExoProtocolErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = 'ExoProtocolError'
    this.code = code
    this.expected = details.expected
    this.received = details.received
  }
}

export interface PluginIdentity {
  id: string
  version: string
}

export interface ShellIdentity {
  version: string
  origin: string
}

export interface FileMetadata {
  path: string
  name: string
  dir: string
  size: number
  mtime: number
  version: string
  languageHint?: string
}

export interface EditorCapabilities {
  read: boolean
  write: boolean
  requestFiles: boolean
  /** Shell support bit for `plugin/request-files`; false on older shells. */
  filePicker: boolean
  /** Shell support bit for `plugin/request-new-file`; false on older shells. */
  createFile: boolean
  /** Shell support bit for `plugin/request-list`; false on older shells. */
  directoryListing: boolean
  /** Shell support bit for plugin-local publication and subscription. */
  localEvents: boolean
  /** Shell support bit for `plugin/open-file`. */
  openFile: boolean
  /** Shell support bit for `plugin/open-view`. */
  openView: boolean
  /** Shell support bit for `plugin/request-panel`. */
  requestPanel: boolean
  /** Shell support bit for `shell/command`; absent on older shells. */
  commands: boolean
}

export type ViewCapabilities = EditorCapabilities

export interface RegistrationCapabilities {
  /** Shell support bit for plugin-local publication and subscription. */
  localEvents: boolean
  /** Shell support bit for `contributes.newFiles` registration. */
  newFiles: boolean
}

export interface FilePickerOptions {
  multiple?: boolean
  /** Optional workspace-relative or `/`-rooted start hint. */
  directory?: string
}

export type NewFileContent = { text: string } | { bytes: ArrayBuffer }

export interface NewFileOptions {
  /** Exactly one of `text` or `bytes` is required. */
  text?: string
  bytes?: ArrayBuffer | ArrayBufferView
  /** A one-segment name hint; the shell validates it. */
  suggestedName?: string
  /** An optional workspace-relative or `/`-rooted start hint. */
  directory?: string
}

export interface NewFileResult {
  path: string
  version: string
}

export interface DirectoryEntry {
  path: string
  kind: 'file' | 'directory'
  /** Present for files only. */
  size?: number
}

export interface DirectoryPage {
  entries: DirectoryEntry[]
  /** Opaque token for the next page; absent on the last page. */
  nextCursor?: string
}

export interface ListDirectoryOptions {
  /** The previous page's `nextCursor`; pass it unchanged. */
  cursor?: string
}

export interface EditorLimits {
  maxFileSize: number
  maxRequestBytes: number
}

export type SettingValue = boolean | string | number
export type SettingValues = Record<string, SettingValue>

interface ShellInitBase {
  protocolVersion: string
  sessionId: string
  plugin: PluginIdentity
  shell: ShellIdentity
  workspace: { name: string }
  theme: ThemeName
  permissions: PluginPermission[]
  locale: string
  settings: SettingValues
}

export interface RegistrationInit extends ShellInitBase {
  mode: 'register'
  capabilities: RegistrationCapabilities
}

export interface EditorInit extends ShellInitBase {
  mode: 'editor'
  file: FileMetadata
  capabilities: EditorCapabilities
  limits: EditorLimits
}

export interface ViewOpenedBy {
  pluginId: string
  pluginName: string
  origin: string
}

export interface ViewInitData {
  kind: 'panel' | 'content'
  id: string
  title: string
  instanceId: string
  location?: 'primary' | 'secondary'
  /** One-shot data from the opener; never file content. */
  payload?: unknown
  openedBy?: ViewOpenedBy
}

export interface ViewInit extends ShellInitBase {
  mode: 'view'
  view: ViewInitData
  capabilities: ViewCapabilities
  limits: EditorLimits
}

export type ShellInit = RegistrationInit | EditorInit | ViewInit

export interface FileEditorContribution {
  glob: string
  entry: string
  label?: string
}

export type RegistrationRejectionReason =
  | 'not-declared'
  | 'permission-denied'
  | 'invalid-glob'
  | 'invalid-contribution'
  | 'target-not-registered'

export interface RejectedContribution {
  index: number
  reason: RegistrationRejectionReason
  kind?: 'fileEditor' | 'panel' | 'contentView' | 'command' | 'newFile'
  message?: string
}

export interface RegistrationAck {
  accepted: string[]
  acceptedPanels: string[]
  acceptedContentViews: string[]
  acceptedCommands: string[]
  acceptedNewFiles: string[]
  rejected: RejectedContribution[]
}

export interface CommandArgs {
  path: string
  kind: 'file' | 'directory'
}

export interface CommandInvocation {
  /** The registered command id. */
  command: string
  args?: CommandArgs
}

export type CommandHandlerResult = void | { ok: true } | { ok: false; message?: string }

export type CommandHandler = (
  invocation: CommandInvocation,
) => CommandHandlerResult | Promise<CommandHandlerResult>

export interface CommandResult {
  ok: boolean
  message?: string
}

export interface OpenViewOptions {
  /** Omit to target the caller's own plugin. */
  pluginId?: string
  viewId: string
  /** Reuses an existing tab when the same key is open. */
  instanceKey?: string
  /** One-shot JSON data; at most 64 KiB. */
  payload?: unknown
}

export interface PanelResult {
  panel: string
  open: boolean
}

export type PanelAction = 'show' | 'hide' | 'toggle'

export interface ShellErrorPayload {
  code: ShellErrorCode
  message?: string
}

export type TextFileContent = { path: string; version: string; text: string }
export type BinaryFileContent = { path: string; version: string; bytes: ArrayBuffer }
export type FileContent = TextFileContent | BinaryFileContent

export type SaveContent = { text: string } | { bytes: ArrayBuffer }

export type SaveResult =
  { ok: true; version: string } | { ok: false; code: ShellErrorCode; message?: string }

export type DisposeReason = 'closed' | 'workspace-switch' | 'plugin-removed' | 'error'

export type FileChangeKind = 'created' | 'changed' | 'deleted' | 'renamed'

export interface FileChangedPayload {
  path: string
  kind: FileChangeKind
  version?: string
}

export const EVENT_TOPICS = [
  'theme/changed',
  'workspace/file-changed',
  'workspace/closed',
  'config/changed',
] as const

export type EventTopic = (typeof EVENT_TOPICS)[number]
export type LocalEventTopic = `local/${string}`
export type AnyEventTopic = EventTopic | LocalEventTopic

/** True for a well-formed `local/<name>` topic; the shell reserves the namespace. */
export function isLocalEventTopic(value: unknown): value is LocalEventTopic {
  return typeof value === 'string' && LOCAL_TOPIC_PATTERN.test(value)
}

export function isEventTopic(value: unknown): value is EventTopic {
  return typeof value === 'string' && (EVENT_TOPICS as readonly string[]).includes(value)
}

export interface ThemeChangedPayload {
  theme: ThemeName
}

export interface WorkspaceClosedPayload {
  reason: 'switch' | 'close'
}

export interface ConfigChangedPayload {
  pluginId: string
  values: Record<string, unknown>
}

export interface EventPayloads {
  'theme/changed': ThemeChangedPayload
  'workspace/file-changed': FileChangedPayload
  'workspace/closed': WorkspaceClosedPayload
  'config/changed': ConfigChangedPayload
}

export interface ShellEvent<T = unknown> {
  topic: AnyEventTopic
  seq: number
  payload: T
  /** Present on local events: the publishing frame's opaque session id. */
  from?: string
}

export type LocalEvent<T = unknown> = ShellEvent<T> & {
  topic: LocalEventTopic
  from: string
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!isPlainObject(value) || value.exo !== 1) return false
  if (typeof value.type !== 'string' || value.type.length === 0) return false
  if (
    value.id !== undefined &&
    (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > MAX_ID_LENGTH)
  ) {
    return false
  }
  if (
    value.replyTo !== undefined &&
    (typeof value.replyTo !== 'string' ||
      value.replyTo.length === 0 ||
      value.replyTo.length > MAX_ID_LENGTH)
  ) {
    return false
  }
  return true
}

function sizeOf(value: unknown, limit: number, seen: Set<object>): number {
  if (typeof value === 'string') return value.length * 2
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return 8
  if (value === null || value === undefined) return 0
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) {
      total += sizeOf(item, limit - total, seen)
      if (total > limit) return total
    }
    return total
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return 0
    seen.add(value)
    let total = 0
    for (const [key, item] of Object.entries(value)) {
      total += key.length * 2 + sizeOf(item, limit - total, seen)
      if (total > limit) return total
    }
    return total
  }
  return 0
}

/** The same conservative envelope size rule the shell applies to payloads. */
export function payloadTooLarge(payload: unknown, limit = MAX_LOCAL_EVENT_BYTES): boolean {
  return sizeOf(payload, limit, new Set()) > limit
}

export interface EnvelopeOptions {
  id?: string
  replyTo?: string
}

export function buildEnvelope(
  type: string,
  payload?: unknown,
  options: EnvelopeOptions = {},
): Envelope {
  if (options.id !== undefined && (options.id.length === 0 || options.id.length > MAX_ID_LENGTH)) {
    throw new ExoProtocolError('protocol-violation', 'A request id must be 1-64 characters.')
  }
  if (
    options.replyTo !== undefined &&
    (options.replyTo.length === 0 || options.replyTo.length > MAX_ID_LENGTH)
  ) {
    throw new ExoProtocolError('protocol-violation', 'A replyTo id must be 1-64 characters.')
  }
  const envelope: Envelope = { exo: 1, type }
  if (options.id !== undefined) envelope.id = options.id
  if (options.replyTo !== undefined) envelope.replyTo = options.replyTo
  if (payload !== undefined) envelope.payload = payload
  return envelope
}
