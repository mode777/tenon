import { describe, expect, it } from 'vitest'
import { connectPlugin } from './handshake'
import {
  ExoProtocolError,
  type EditorInit,
  type PluginPermission,
  type RegistrationInit,
} from './protocol'
import { FakePluginTransport } from './testing'

const SHELL_ORIGIN = 'https://editor.example.com'
const SESSION_ID = 'session-1'

function base(mode: 'register' | 'editor') {
  return {
    protocolVersion: '1',
    mode,
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '1.0.0' },
    shell: { version: '0.1.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark' as const,
    permissions: ['workspace:read', 'workspace:write'] as PluginPermission[],
    locale: 'en',
    settings: { 'template.greeting': 'hello' },
  }
}

function registerInit(overrides: Partial<RegistrationInit> = {}): RegistrationInit {
  return {
    ...base('register'),
    mode: 'register',
    capabilities: { localEvents: true, newFiles: true },
    ...overrides,
  }
}

function editorInit(overrides: Partial<EditorInit> = {}): EditorInit {
  return {
    ...base('editor'),
    mode: 'editor',
    file: {
      path: '/notes.template.txt',
      name: 'notes.template.txt',
      dir: '/',
      size: 5,
      mtime: 1000,
      version: 'v1',
    },
    capabilities: {
      read: true,
      write: true,
      requestFiles: true,
      filePicker: true,
      createFile: true,
      directoryListing: true,
      localEvents: true,
      openFile: true,
      openView: true,
      requestPanel: true,
      commands: true,
    },
    limits: { maxFileSize: 10 * 1024 * 1024, maxRequestBytes: 16 * 1024 * 1024 },
    ...overrides,
  }
}

function transport(mode: 'register' | 'editor' = 'register') {
  return new FakePluginTransport({
    hostOrigin: SHELL_ORIGIN,
    sessionId: SESSION_ID,
    mode,
  })
}

describe('handshake', () => {
  it('sends one ready and returns the typed registration client', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake })
    expect(fake.last('plugin/ready')?.payload).toEqual({
      protocolVersion: '1',
      sessionId: SESSION_ID,
    })
    fake.emit({ exo: 1, type: 'shell/init', payload: registerInit() })
    const connection = await promise
    expect(connection.mode).toBe('register')
    if (connection.mode === 'register') {
      expect(connection.init.plugin.id).toBe('com.example.template')
      expect(connection.init.settings).toEqual({ 'template.greeting': 'hello' })
    }
    expect(fake.posted.filter((envelope) => envelope.type === 'plugin/ready')).toHaveLength(1)
  })

  it('returns the typed editor client with metadata', async () => {
    const fake = transport('editor')
    const promise = connectPlugin({ transport: fake })
    fake.emit({ exo: 1, type: 'shell/init', payload: editorInit() })
    const connection = await promise
    expect(connection.mode).toBe('editor')
    if (connection.mode === 'editor') {
      expect(connection.editor.file.path).toBe('/notes.template.txt')
      expect(connection.editor.capabilities.write).toBe(true)
      expect(connection.editor.limits.maxRequestBytes).toBe(16 * 1024 * 1024)
    }
  })

  it('defaults a missing filePicker support bit to false', async () => {
    const fake = transport('editor')
    const promise = connectPlugin({ transport: fake })
    const payload = editorInit()
    delete (payload.capabilities as Partial<EditorInit['capabilities']>).filePicker
    fake.emit({ exo: 1, type: 'shell/init', payload })
    const connection = await promise
    if (connection.mode !== 'editor') throw new Error('expected editor mode')
    expect(connection.editor.capabilities.filePicker).toBe(false)
  })

  it('rejects a non-boolean filePicker support bit', async () => {
    const fake = transport('editor')
    const promise = connectPlugin({ transport: fake })
    fake.emit({
      exo: 1,
      type: 'shell/init',
      payload: editorInit({
        capabilities: {
          read: true,
          write: true,
          requestFiles: true,
          filePicker: 'yes',
        } as unknown as EditorInit['capabilities'],
      }),
    })
    await expect(promise).rejects.toMatchObject({ code: 'protocol-violation' })
  })

  it('parses the directoryListing support bit and defaults absence to false', async () => {
    const newShell = transport('editor')
    const newPromise = connectPlugin({ transport: newShell })
    newShell.emit({ exo: 1, type: 'shell/init', payload: editorInit() })
    const connected = await newPromise
    if (connected.mode !== 'editor') throw new Error('expected editor mode')
    expect(connected.editor.capabilities.directoryListing).toBe(true)

    const oldShell = transport('editor')
    const oldPromise = connectPlugin({ transport: oldShell })
    const payload = editorInit()
    delete (payload.capabilities as Partial<EditorInit['capabilities']>).directoryListing
    oldShell.emit({ exo: 1, type: 'shell/init', payload })
    const old = await oldPromise
    if (old.mode !== 'editor') throw new Error('expected editor mode')
    expect(old.editor.capabilities.directoryListing).toBe(false)
  })

  it('rejects a non-boolean directoryListing support bit', async () => {
    const fake = transport('editor')
    const promise = connectPlugin({ transport: fake })
    fake.emit({
      exo: 1,
      type: 'shell/init',
      payload: editorInit({
        capabilities: {
          read: true,
          write: true,
          requestFiles: true,
          filePicker: true,
          createFile: true,
          directoryListing: 'yes',
        } as unknown as EditorInit['capabilities'],
      }),
    })
    await expect(promise).rejects.toMatchObject({ code: 'protocol-violation' })
  })

  it('parses localEvents for editor and registration and defaults absence to false', async () => {
    const editor = transport('editor')
    const editorPromise = connectPlugin({ transport: editor })
    editor.emit({ exo: 1, type: 'shell/init', payload: editorInit() })
    const connectedEditor = await editorPromise
    if (connectedEditor.mode !== 'editor') throw new Error('expected editor mode')
    expect(connectedEditor.editor.capabilities.localEvents).toBe(true)

    const oldEditor = transport('editor')
    const oldEditorPromise = connectPlugin({ transport: oldEditor })
    const editorPayload = editorInit()
    delete (editorPayload.capabilities as Partial<EditorInit['capabilities']>).localEvents
    oldEditor.emit({ exo: 1, type: 'shell/init', payload: editorPayload })
    const oldEditorConnection = await oldEditorPromise
    if (oldEditorConnection.mode !== 'editor') throw new Error('expected editor mode')
    expect(oldEditorConnection.editor.capabilities.localEvents).toBe(false)

    const register = transport()
    const registerPromise = connectPlugin({ transport: register })
    register.emit({ exo: 1, type: 'shell/init', payload: registerInit() })
    const connectedRegister = await registerPromise
    if (connectedRegister.mode !== 'register') throw new Error('expected register mode')
    expect(connectedRegister.init.capabilities.localEvents).toBe(true)

    const oldRegister = transport()
    const oldRegisterPromise = connectPlugin({ transport: oldRegister })
    const registerPayload = registerInit()
    delete (registerPayload as { capabilities?: unknown }).capabilities
    oldRegister.emit({ exo: 1, type: 'shell/init', payload: registerPayload })
    const oldRegisterConnection = await oldRegisterPromise
    if (oldRegisterConnection.mode !== 'register') throw new Error('expected register mode')
    expect(oldRegisterConnection.init.capabilities.localEvents).toBe(false)
  })

  it('rejects a non-boolean localEvents support bit', async () => {
    const fake = transport('editor')
    const promise = connectPlugin({ transport: fake })
    fake.emit({
      exo: 1,
      type: 'shell/init',
      payload: editorInit({
        capabilities: {
          read: true,
          write: true,
          requestFiles: true,
          filePicker: true,
          createFile: true,
          directoryListing: true,
          localEvents: 'yes',
        } as unknown as EditorInit['capabilities'],
      }),
    })
    await expect(promise).rejects.toMatchObject({ code: 'protocol-violation' })
  })

  it('surfaces a shell unsupported-version rejection with both versions', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake, protocolVersion: '2' })
    fake.emit({ exo: 1, type: 'shell/error', payload: { code: 'unsupported-version' } })
    const error = await promise.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ExoProtocolError)
    expect(error).toMatchObject({
      code: 'unsupported-version',
      expected: '1',
      received: '2',
    })
  })

  it('rejects an init with a different protocol major', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake })
    fake.emit({
      exo: 1,
      type: 'shell/init',
      payload: { ...registerInit(), protocolVersion: '2' },
    })
    await expect(promise).rejects.toMatchObject({
      code: 'unsupported-version',
      expected: '1',
      received: '2',
    })
  })

  it('rejects a wrong mode and a wrong session as identity errors', async () => {
    const wrongMode = transport()
    const modePromise = connectPlugin({ transport: wrongMode })
    wrongMode.emit({ exo: 1, type: 'shell/init', payload: editorInit() })
    await expect(modePromise).rejects.toMatchObject({ code: 'identity' })

    const wrongSession = transport()
    const sessionPromise = connectPlugin({ transport: wrongSession })
    wrongSession.emit({
      exo: 1,
      type: 'shell/init',
      payload: registerInit({ sessionId: 'other' }),
    })
    await expect(sessionPromise).rejects.toMatchObject({ code: 'identity' })
  })

  it('rejects a malformed init', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake })
    fake.emit({ exo: 1, type: 'shell/init', payload: {} })
    await expect(promise).rejects.toMatchObject({ code: 'protocol-violation' })
  })

  it('times out when no init arrives', async () => {
    const fake = transport()
    await expect(connectPlugin({ transport: fake, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('ignores init from a foreign origin', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake, timeoutMs: 5 })
    fake.emit(
      { exo: 1, type: 'shell/init', payload: registerInit() },
      { origin: 'https://evil.example.com' },
    )
    await expect(promise).rejects.toMatchObject({ code: 'timeout' })
  })
})
