import { describe, expect, it } from 'vitest'
import { connectPlugin } from './handshake'
import type { EditorInit } from './protocol'
import { FakePluginTransport } from './testing'

const SHELL_ORIGIN = 'https://editor.example.com'
const SESSION_ID = 'session-1'

function init(overrides: Partial<EditorInit> = {}): EditorInit {
  return {
    protocolVersion: '1',
    mode: 'editor',
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '1.0.0' },
    shell: { version: '0.5.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark',
    permissions: ['workspace:read', 'workspace:write'],
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

async function connect(overrides: Partial<EditorInit> = {}) {
  const transport = new FakePluginTransport({
    hostOrigin: SHELL_ORIGIN,
    sessionId: SESSION_ID,
    mode: 'editor',
  })
  const promise = connectPlugin({ transport })
  transport.emit({ exo: 1, type: 'shell/init', payload: init(overrides) })
  const connection = await promise
  if (connection.mode !== 'editor') throw new Error('expected editor mode')
  return { transport, editor: connection.editor }
}

function postedId(transport: FakePluginTransport, type: string): string {
  const envelope = transport.last(type)
  if (!envelope?.id) throw new Error(`no ${type} id`)
  return envelope.id
}

describe('new-file client', () => {
  it('sends text and resolves the created path and version', async () => {
    const { transport, editor } = await connect()
    const pending = editor.requestNewFile({ text: 'hello', suggestedName: 'notes.md' })
    const id = postedId(transport, 'plugin/request-new-file')
    expect(transport.last('plugin/request-new-file')?.payload).toEqual({
      text: 'hello',
      suggestedName: 'notes.md',
    })
    transport.emit({
      exo: 1,
      type: 'shell/new-file-result',
      replyTo: id,
      payload: { path: '/notes.md', version: 'm2' },
    })
    await expect(pending).resolves.toEqual({ path: '/notes.md', version: 'm2' })
  })

  it('sends exact bytes without decoding them', async () => {
    const { transport, editor } = await connect()
    const bytes = new Uint8Array([0, 128, 255])
    const pending = editor.requestNewFile({ bytes, directory: '/assets' })
    const id = postedId(transport, 'plugin/request-new-file')
    const payload = transport.last('plugin/request-new-file')?.payload as {
      bytes: ArrayBuffer
      directory?: string
    }
    expect(Array.from(new Uint8Array(payload.bytes))).toEqual([0, 128, 255])
    expect(payload.directory).toBe('/assets')
    transport.emit({
      exo: 1,
      type: 'shell/new-file-result',
      replyTo: id,
      payload: { path: '/assets/image.bin', version: 'm1' },
    })
    await expect(pending).resolves.toMatchObject({ path: '/assets/image.bin' })
  })

  it('resolves null when the user cancels', async () => {
    const { transport, editor } = await connect()
    const pending = editor.requestNewFile({ text: 'x' })
    const id = postedId(transport, 'plugin/request-new-file')
    transport.emit({
      exo: 1,
      type: 'shell/new-file-result',
      replyTo: id,
      payload: { cancelled: true },
    })
    await expect(pending).resolves.toBeNull()
  })

  it('preflights the size, the support bit and the write permission', async () => {
    const { transport, editor } = await connect()
    await expect(
      editor.requestNewFile({ bytes: new Uint8Array(8 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: 'too-large' })
    expect(transport.posted.filter((item) => item.type === 'plugin/request-new-file')).toHaveLength(
      0,
    )

    const oldCapabilities = {
      ...init().capabilities,
      createFile: false,
    }
    const old = await connect({ capabilities: oldCapabilities })
    await expect(old.editor.requestNewFile({ text: 'x' })).rejects.toMatchObject({
      code: 'unsupported-message',
    })
    expect(
      old.transport.posted.filter((item) => item.type === 'plugin/request-new-file'),
    ).toHaveLength(0)

    const readOnly = await connect({ permissions: ['workspace:read'] })
    await expect(readOnly.editor.requestNewFile({ text: 'x' })).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(
      readOnly.transport.posted.filter((item) => item.type === 'plugin/request-new-file'),
    ).toHaveLength(0)
  })

  it('rejects both or neither content field locally', async () => {
    const { transport, editor } = await connect()
    await expect(editor.requestNewFile({})).rejects.toMatchObject({
      code: 'protocol-violation',
    })
    await expect(
      editor.requestNewFile({ text: 'a', bytes: new ArrayBuffer(1) }),
    ).rejects.toMatchObject({ code: 'protocol-violation' })
    expect(transport.posted.filter((item) => item.type === 'plugin/request-new-file')).toHaveLength(
      0,
    )
  })

  it('allows one pending request and rejects disposal', async () => {
    const { transport, editor } = await connect()
    const first = editor.requestNewFile({ text: 'a' })
    await expect(editor.requestNewFile({ text: 'b' })).rejects.toMatchObject({
      code: 'rate-limited',
    })
    expect(transport.posted.filter((item) => item.type === 'plugin/request-new-file')).toHaveLength(
      1,
    )
    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'closed' } })
    await expect(first).rejects.toMatchObject({ code: 'closed' })
  })

  it('rejects a malformed result as a protocol violation', async () => {
    const { transport, editor } = await connect()
    const pending = editor.requestNewFile({ text: 'a' })
    const id = postedId(transport, 'plugin/request-new-file')
    transport.emit({
      exo: 1,
      type: 'shell/new-file-result',
      replyTo: id,
      payload: { path: 42 },
    })
    await expect(pending).rejects.toMatchObject({ code: 'protocol-violation' })
  })
})
