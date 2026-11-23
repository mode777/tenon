import { describe, expect, it, vi } from 'vitest'
import {
  CommandClient,
  MAX_COMMAND_MESSAGE,
  MAX_EARLY_COMMANDS,
  parseCommandInvocation,
} from './command'
import { MessageGate } from './gate'
import { connectPlugin } from './handshake'
import type { EditorInit, ViewInit } from './protocol'
import { FakePluginTransport } from './testing'

const SHELL_ORIGIN = 'https://editor.example.com'
const SESSION_ID = 'session-1'

function setup() {
  const transport = new FakePluginTransport({
    hostOrigin: SHELL_ORIGIN,
    sessionId: SESSION_ID,
    mode: 'editor',
  })
  const gate = new MessageGate(transport)
  const client = new CommandClient(gate)
  return { transport, client }
}

function emit(transport: FakePluginTransport, id: string, payload: unknown): void {
  transport.emit({ exo: 1, type: 'shell/command', id, payload })
}

function results(transport: FakePluginTransport) {
  return transport.posted.filter((entry) => entry.type === 'plugin/command-result')
}

function editorInit(overrides: Partial<EditorInit> = {}): EditorInit {
  return {
    protocolVersion: '1',
    mode: 'editor',
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '1.0.0' },
    shell: { version: '0.4.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark',
    permissions: ['workspace:read'],
    locale: 'en',
    settings: {},
    file: {
      path: '/notes.txt',
      name: 'notes.txt',
      dir: '/',
      size: 5,
      mtime: 1000,
      version: 'v1',
    },
    capabilities: {
      read: true,
      write: false,
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
    limits: { maxFileSize: 1024, maxRequestBytes: 1024 },
    ...overrides,
  }
}

function viewInit(overrides: Partial<ViewInit> = {}): ViewInit {
  return {
    protocolVersion: '1',
    mode: 'view',
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '1.0.0' },
    shell: { version: '0.4.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark',
    permissions: ['workspace:read'],
    locale: 'en',
    settings: {},
    view: { kind: 'panel', id: 'reports', title: 'Reports', instanceId: 'panel:x' },
    capabilities: {
      read: true,
      write: false,
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
    limits: { maxFileSize: 1024, maxRequestBytes: 1024 },
    ...overrides,
  }
}

async function connect(mode: 'editor' | 'view', overrides: Partial<EditorInit | ViewInit> = {}) {
  const transport = new FakePluginTransport({
    hostOrigin: SHELL_ORIGIN,
    sessionId: SESSION_ID,
    mode,
  })
  const promise = connectPlugin({ transport })
  transport.emit({
    exo: 1,
    type: 'shell/init',
    payload:
      mode === 'editor'
        ? editorInit(overrides as Partial<EditorInit>)
        : viewInit(overrides as Partial<ViewInit>),
  })
  const connection = await promise
  return { transport, connection }
}

describe('command client', () => {
  it('dispatches a command and answers one correlated success', async () => {
    const { transport, client } = setup()
    const handler = vi.fn()
    client.onCommand(handler)
    emit(transport, 'cmd-1', { command: 'format', args: { path: '/notes.txt', kind: 'file' } })
    await vi.waitFor(() => expect(results(transport)).toHaveLength(1))
    expect(handler).toHaveBeenCalledWith({
      command: 'format',
      args: { path: '/notes.txt', kind: 'file' },
    })
    expect(results(transport)[0]).toMatchObject({
      replyTo: 'cmd-1',
      payload: { ok: true },
    })
  })

  it('turns a thrown error or an explicit failure into a bounded failure result', async () => {
    const { transport, client } = setup()
    client.onCommand(() => {
      throw new Error('x'.repeat(500))
    })
    emit(transport, 'cmd-1', { command: 'format' })
    await vi.waitFor(() => expect(results(transport)).toHaveLength(1))
    const failure = results(transport)[0]?.payload as { ok: boolean; message: string }
    expect(failure.ok).toBe(false)
    expect(failure.message).toHaveLength(MAX_COMMAND_MESSAGE)

    client.onCommand(() => ({ ok: false, message: 'No selection' }))
    emit(transport, 'cmd-2', { command: 'format' })
    await vi.waitFor(() => expect(results(transport)).toHaveLength(2))
    expect(results(transport)[1]?.payload).toEqual({ ok: false, message: 'No selection' })
  })

  it('queues up to ten early commands and fails the excess', async () => {
    const { transport, client } = setup()
    for (let index = 0; index < MAX_EARLY_COMMANDS + 1; index += 1) {
      emit(transport, `cmd-${index}`, { command: 'format' })
    }
    expect(results(transport)).toHaveLength(1)
    expect(results(transport)[0]?.payload).toMatchObject({ ok: false })

    const handler = vi.fn()
    client.onCommand(handler)
    await vi.waitFor(() => expect(results(transport)).toHaveLength(MAX_EARLY_COMMANDS + 1))
    expect(handler).toHaveBeenCalledTimes(MAX_EARLY_COMMANDS)
  })

  it('answers an invalid payload and ignores messages after disposal', async () => {
    const { transport, client } = setup()
    client.onCommand(() => undefined)
    emit(transport, 'cmd-1', { command: 'format', extra: true })
    expect(results(transport)[0]?.payload).toMatchObject({ ok: false })
    client.dispose()
    emit(transport, 'cmd-2', { command: 'format' })
    expect(results(transport)).toHaveLength(1)
  })

  it('accepts command support on editor and view clients, including older shells', async () => {
    const editor = await connect('editor')
    expect(editor.connection.mode).toBe('editor')
    if (editor.connection.mode === 'editor') {
      expect(editor.connection.editor.supportsCommands).toBe(true)
    }
    const view = await connect('view')
    expect(view.connection.mode).toBe('view')
    if (view.connection.mode === 'view') {
      expect(view.connection.view.supportsCommands).toBe(true)
    }

    const older = await connect('editor', {
      capabilities: {
        read: true,
        write: false,
        requestFiles: true,
        filePicker: true,
        createFile: true,
        directoryListing: true,
        localEvents: true,
        openFile: true,
        openView: true,
        requestPanel: true,
      } as unknown as EditorInit['capabilities'],
    })
    if (older.connection.mode === 'editor') {
      expect(older.connection.editor.supportsCommands).toBe(false)
      expect(older.connection.editor.capabilities.commands).toBe(false)
    }
  })

  it('parses only the documented invocation shape', () => {
    expect(parseCommandInvocation({ command: 'format' })).toEqual({ command: 'format' })
    expect(
      parseCommandInvocation({ command: 'format', args: { path: '/a', kind: 'directory' } }),
    ).toEqual({ command: 'format', args: { path: '/a', kind: 'directory' } })
    expect(parseCommandInvocation({ command: 'format', extra: true })).toBeNull()
    expect(parseCommandInvocation({ command: '' })).toBeNull()
    expect(
      parseCommandInvocation({ command: 'format', args: { path: '/a', kind: 'x' } }),
    ).toBeNull()
    expect(
      parseCommandInvocation({ command: 'format', args: { path: '/a', kind: 'file', x: 1 } }),
    ).toBeNull()
  })
})
