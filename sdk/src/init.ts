import {
  ExoProtocolError,
  isPlainObject,
  type EditorCapabilities,
  type EditorInit,
  type EditorLimits,
  type FileMetadata,
  type PluginMode,
  type PluginPermission,
  type RegistrationCapabilities,
  type RegistrationInit,
  type ShellErrorCode,
  type ShellErrorPayload,
  type ShellInit,
  type SettingValues,
  type ThemeName,
  type ViewInit,
  type ViewInitData,
} from './protocol'

const THEMES: ThemeName[] = ['dark', 'light', 'high-contrast']

const SHELL_ERROR_CODES: ShellErrorCode[] = [
  'unsupported-message',
  'unsupported-version',
  'protocol-violation',
  'timeout',
  'loading-failed',
  'permission-denied',
  'not-found',
  'not-a-file',
  'not-a-directory',
  'already-exists',
  'too-large',
  'conflict',
  'rate-limited',
  'unsupported-topic',
  'internal',
]

function invalid(path: string, message: string): never {
  throw new ExoProtocolError('protocol-violation', `Invalid shell/init at ${path}: ${message}`)
}

function stringAt(value: Record<string, unknown>, key: string, path: string): string {
  const item = value[key]
  if (typeof item !== 'string') invalid(`${path}.${key}`, 'expected a string')
  return item
}

function numberAt(value: Record<string, unknown>, key: string, path: string): number {
  const item = value[key]
  if (typeof item !== 'number' || !Number.isFinite(item)) {
    invalid(`${path}.${key}`, 'expected a finite number')
  }
  return item
}

function booleanAt(value: Record<string, unknown>, key: string, path: string): boolean {
  const item = value[key]
  if (typeof item !== 'boolean') invalid(`${path}.${key}`, 'expected a boolean')
  return item
}

function objectAt(
  value: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> {
  const item = value[key]
  if (!isPlainObject(item)) invalid(`${path}.${key}`, 'expected an object')
  return item
}

function settingsAt(value: Record<string, unknown>, path: string): SettingValues {
  const settings = objectAt(value, 'settings', path)
  const result: SettingValues = {}
  for (const [key, item] of Object.entries(settings)) {
    if (typeof item !== 'boolean' && typeof item !== 'string' && typeof item !== 'number') {
      invalid(`${path}.settings.${key}`, 'expected a boolean, string or number')
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      invalid(`${path}.settings.${key}`, 'expected a finite number')
    }
    result[key] = item
  }
  return result
}

function fileAt(value: Record<string, unknown>, path: string): FileMetadata {
  const file = objectAt(value, 'file', path)
  const metadata: FileMetadata = {
    path: stringAt(file, 'path', `${path}.file`),
    name: stringAt(file, 'name', `${path}.file`),
    dir: stringAt(file, 'dir', `${path}.file`),
    size: numberAt(file, 'size', `${path}.file`),
    mtime: numberAt(file, 'mtime', `${path}.file`),
    version: stringAt(file, 'version', `${path}.file`),
  }
  if (file.languageHint !== undefined) {
    metadata.languageHint = stringAt(file, 'languageHint', `${path}.file`)
  }
  return metadata
}

function capabilitiesAt(value: Record<string, unknown>, path: string): EditorCapabilities {
  const capabilities = objectAt(value, 'capabilities', path)
  return {
    read: booleanAt(capabilities, 'read', `${path}.capabilities`),
    write: booleanAt(capabilities, 'write', `${path}.capabilities`),
    requestFiles: booleanAt(capabilities, 'requestFiles', `${path}.capabilities`),
    filePicker:
      capabilities.filePicker === undefined
        ? false
        : booleanAt(capabilities, 'filePicker', `${path}.capabilities`),
    createFile:
      capabilities.createFile === undefined
        ? false
        : booleanAt(capabilities, 'createFile', `${path}.capabilities`),
    directoryListing:
      capabilities.directoryListing === undefined
        ? false
        : booleanAt(capabilities, 'directoryListing', `${path}.capabilities`),
    localEvents:
      capabilities.localEvents === undefined
        ? false
        : booleanAt(capabilities, 'localEvents', `${path}.capabilities`),
    openFile:
      capabilities.openFile === undefined
        ? false
        : booleanAt(capabilities, 'openFile', `${path}.capabilities`),
    openView:
      capabilities.openView === undefined
        ? false
        : booleanAt(capabilities, 'openView', `${path}.capabilities`),
    requestPanel:
      capabilities.requestPanel === undefined
        ? false
        : booleanAt(capabilities, 'requestPanel', `${path}.capabilities`),
    commands:
      capabilities.commands === undefined
        ? false
        : booleanAt(capabilities, 'commands', `${path}.capabilities`),
  }
}

function viewAt(value: Record<string, unknown>, path: string): ViewInitData {
  const view = objectAt(value, 'view', path)
  const kind = stringAt(view, 'kind', `${path}.view`)
  if (kind !== 'panel' && kind !== 'content') {
    invalid(`${path}.view.kind`, 'expected panel or content')
  }
  const data: ViewInitData = {
    kind,
    id: stringAt(view, 'id', `${path}.view`),
    title: stringAt(view, 'title', `${path}.view`),
    instanceId: stringAt(view, 'instanceId', `${path}.view`),
  }
  if (view.location !== undefined) {
    const location = stringAt(view, 'location', `${path}.view`)
    if (location !== 'primary' && location !== 'secondary') {
      invalid(`${path}.view.location`, 'expected primary or secondary')
    }
    data.location = location
  }
  if (view.payload !== undefined) data.payload = view.payload
  if (view.openedBy !== undefined) {
    const openedBy = objectAt(view, 'openedBy', `${path}.view`)
    data.openedBy = {
      pluginId: stringAt(openedBy, 'pluginId', `${path}.view.openedBy`),
      pluginName: stringAt(openedBy, 'pluginName', `${path}.view.openedBy`),
      origin: stringAt(openedBy, 'origin', `${path}.view.openedBy`),
    }
  }
  return data
}

function registrationCapabilitiesAt(
  value: Record<string, unknown>,
  path: string,
): RegistrationCapabilities {
  if (value.capabilities === undefined) return { localEvents: false, newFiles: false }
  const capabilities = objectAt(value, 'capabilities', path)
  return {
    localEvents:
      capabilities.localEvents === undefined
        ? false
        : booleanAt(capabilities, 'localEvents', `${path}.capabilities`),
    newFiles:
      capabilities.newFiles === undefined
        ? false
        : booleanAt(capabilities, 'newFiles', `${path}.capabilities`),
  }
}

function limitsAt(value: Record<string, unknown>, path: string): EditorLimits {
  const limits = objectAt(value, 'limits', path)
  return {
    maxFileSize: numberAt(limits, 'maxFileSize', `${path}.limits`),
    maxRequestBytes: numberAt(limits, 'maxRequestBytes', `${path}.limits`),
  }
}

export function parseShellInit(
  payload: unknown,
  transport: { mode: PluginMode; sessionId: string },
  requestedVersion: string,
): ShellInit {
  if (!isPlainObject(payload)) invalid('/', 'expected an object')
  const init = payload
  const protocolVersion = stringAt(init, 'protocolVersion', '/')
  const mode = stringAt(init, 'mode', '/')
  const sessionId = stringAt(init, 'sessionId', '/')

  if (protocolVersion !== requestedVersion) {
    throw new ExoProtocolError(
      'unsupported-version',
      `The shell reported protocol version ${protocolVersion}; this SDK requested ${requestedVersion}.`,
      { expected: requestedVersion, received: protocolVersion },
    )
  }
  if (mode !== transport.mode) {
    throw new ExoProtocolError(
      'identity',
      `The shell initialized a ${mode} frame where a ${transport.mode} frame was mounted.`,
    )
  }
  if (sessionId !== transport.sessionId) {
    throw new ExoProtocolError('identity', 'The shell session id does not match the frame session.')
  }

  const plugin = objectAt(init, 'plugin', '/')
  const shell = objectAt(init, 'shell', '/')
  const workspace = objectAt(init, 'workspace', '/')
  const theme = stringAt(init, 'theme', '/')
  if (!THEMES.includes(theme as ThemeName)) invalid('/theme', 'unknown theme')
  const permissions = init.permissions
  if (!Array.isArray(permissions) || permissions.some((item) => typeof item !== 'string')) {
    invalid('/permissions', 'expected an array of strings')
  }

  const base = {
    protocolVersion,
    sessionId,
    plugin: {
      id: stringAt(plugin, 'id', '/plugin'),
      version: stringAt(plugin, 'version', '/plugin'),
    },
    shell: {
      version: stringAt(shell, 'version', '/shell'),
      origin: stringAt(shell, 'origin', '/shell'),
    },
    workspace: { name: stringAt(workspace, 'name', '/workspace') },
    theme: theme as ThemeName,
    permissions: permissions as PluginPermission[],
    locale: stringAt(init, 'locale', '/'),
    settings: settingsAt(init, '/'),
  }

  if (mode === 'register') {
    return {
      ...base,
      mode,
      capabilities: registrationCapabilitiesAt(init, '/'),
    } satisfies RegistrationInit
  }
  if (mode === 'view') {
    return {
      ...base,
      mode,
      view: viewAt(init, '/'),
      capabilities: capabilitiesAt(init, '/'),
      limits: limitsAt(init, '/'),
    } satisfies ViewInit
  }
  if (mode !== 'editor') invalid('/mode', 'expected register, editor or view')
  return {
    ...base,
    mode,
    file: fileAt(init, '/'),
    capabilities: capabilitiesAt(init, '/'),
    limits: limitsAt(init, '/'),
  } satisfies EditorInit
}

export function parseShellError(payload: unknown): ShellErrorPayload | null {
  if (!isPlainObject(payload)) return null
  const code = payload.code
  if (typeof code !== 'string' || !SHELL_ERROR_CODES.includes(code as ShellErrorCode)) return null
  if (payload.message !== undefined && typeof payload.message !== 'string') return null
  return {
    code: code as ShellErrorCode,
    ...(payload.message === undefined ? {} : { message: payload.message }),
  }
}
