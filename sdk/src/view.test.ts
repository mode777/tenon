import { describe, expect, it } from 'vitest'
import { MessageGate } from './gate'
import { connectPlugin } from './handshake'
import { MAX_VIEW_PAYLOAD_BYTES, type EditorCapabilities, type ViewInit } from './protocol'
import { FakePluginTransport } from './testing'
import { ViewClient } from './view'

const SESSION_ID = 'session-1'

function capabilities(overrides: Partial<EditorCapabilities> = {}): EditorCapabilities {
  return {
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
    ...overrides,
  }
}

function viewInit(overrides: Partial<ViewInit> = {}): ViewInit {
  return {
    protocolVersion: '1',
    mode: 'view',
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.viewer', version: '1.0.0' },
    shell: { version: '0.3.0', origin: 'https://editor.example.com' },
    workspace: { name: 'demo' },
    theme: 'dark',
    permissions: ['workspace:read', 'workspace:list', 'events:subscribe'],
    locale: 'en',
    settings: {},
    view: {
      kind: 'content',
      id: 'tutorial',
      title: 'Tutorial',
      instanceId: 'instance-1',
      payload: { chapter: 2 },
      openedBy: {
        pluginId: 'com.example.other',
        pluginName: 'Other',
        origin: 'https://other.example.com',
      },
    },
    capabilities: capabilities(),
    limits: { maxFileSize: 10 * 1024 * 1024, maxRequestBytes: 16 * 1024 * 1024 },
    ...overrides,
  }
}

async function connect(init: ViewInit = viewInit()) {
  const transport = new FakePluginTransport({ mode: 'view', sessionId: SESSION_ID })
  const promise = connectPlugin({ transport })
  transport.emit({ exo: 1, type: 'shell/init', payload: init })
  const connection = await promise
  if (connection.mode !== 'view') throw new Error('expected view mode')
  return { transport, connection, client: connection.view }
}

function emitResult(
  transport: FakePluginTransport,
  type: string,
  payload: unknown,
  replyTo: string,
) {
  transport.emit({ exo: 1, type, replyTo, payload })
}

describe('view client', () => {
  it('connects in view mode with the view block and capabilities', async () => {
    const { client } = await connect()
    expect(client.view).toMatchObject({
      kind: 'content',
      id: 'tutorial',
      title: 'Tutorial',
      instanceId: 'instance-1',
      payload: { chapter: 2 },
      openedBy: { pluginId: 'com.example.other' },
    })
    expect(client.capabilities).toEqual(capabilities())
    expect(client.settings).toEqual({})
    expect('setDirty' in client).toBe(false)
    expect('requestSave' in client).toBe(false)
    expect('onSaveRequest' in client).toBe(false)
  })

  it('rejects a shell init for another mode', async () => {
    const transport = new FakePluginTransport({ mode: 'view', sessionId: SESSION_ID })
    const promise = connectPlugin({ transport })
    transport.emit({ exo: 1, type: 'shell/init', payload: viewInit({ mode: 'editor' as never }) })
    await expect(promise).rejects.toMatchObject({ code: 'identity' })
  })

  it('reads files and lists directories through the shared path', async () => {
    const { transport, client } = await connect()
    const read = client.readFile('/notes.txt')
    const readRequest = transport.last('plugin/request-file')
    expect(readRequest?.payload).toEqual({ path: '/notes.txt', encoding: 'utf8' })
    emitResult(
      transport,
      'shell/file-content',
      { path: '/notes.txt', version: 'v1', text: 'hello' },
      readRequest?.id ?? '',
    )
    await expect(read).resolves.toEqual({ path: '/notes.txt', version: 'v1', text: 'hello' })

    const listing = client.listDirectory('/')
    const listRequest = transport.last('plugin/request-list')
    emitResult(
      transport,
      'shell/list-result',
      { entries: [{ path: '/notes.txt', kind: 'file', size: 5 }] },
      listRequest?.id ?? '',
    )
    await expect(listing).resolves.toEqual({
      entries: [{ path: '/notes.txt', kind: 'file', size: 5 }],
    })
  })

  it('opens a file and rejects relative paths locally', async () => {
    const { transport, client } = await connect()
    const opened = client.openFile('/notes.txt')
    const request = transport.last('plugin/open-file')
    expect(request?.payload).toEqual({ path: '/notes.txt' })
    emitResult(transport, 'shell/open-result', { ok: true }, request?.id ?? '')
    await expect(opened).resolves.toEqual({ ok: true })

    await expect(client.openFile('notes.txt')).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('preflights open-file support and permission without sending', async () => {
    const noRead = await connect(viewInit({ permissions: [] }))
    const before = noRead.transport.posted.length
    await expect(noRead.client.openFile('/notes.txt')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(noRead.transport.posted).toHaveLength(before)

    const old = await connect(viewInit({ capabilities: capabilities({ openFile: false }) }))
    await expect(old.client.openFile('/notes.txt')).rejects.toMatchObject({
      code: 'unsupported-message',
    })
  })

  it('opens a view with a payload and enforces the 64 KiB limit', async () => {
    const { transport, client } = await connect()
    const opened = client.openView({
      pluginId: 'com.example.other',
      viewId: 'tutorial',
      instanceKey: 'chapter-2',
      payload: { chapter: 2 },
    })
    const request = transport.last('plugin/open-view')
    expect(request?.payload).toEqual({
      pluginId: 'com.example.other',
      viewId: 'tutorial',
      instanceKey: 'chapter-2',
      payload: { chapter: 2 },
    })
    emitResult(transport, 'shell/open-result', { ok: true }, request?.id ?? '')
    await expect(opened).resolves.toEqual({ ok: true })

    const before = transport.posted.length
    await expect(
      client.openView({ viewId: 'tutorial', payload: 'x'.repeat(MAX_VIEW_PAYLOAD_BYTES) }),
    ).rejects.toMatchObject({ code: 'too-large' })
    expect(transport.posted).toHaveLength(before)
  })

  it('requests a panel and resolves its state', async () => {
    const { transport, client } = await connect()
    const request = client.requestPanel('outline', 'show')
    const message = transport.last('plugin/request-panel')
    expect(message?.payload).toEqual({ panel: 'outline', action: 'show' })
    emitResult(transport, 'shell/panel-result', { panel: 'outline', open: true }, message?.id ?? '')
    await expect(request).resolves.toEqual({ panel: 'outline', open: true })
    await expect(client.requestPanel('outline', 'sideways' as never)).rejects.toMatchObject({
      code: 'protocol-violation',
    })
  })

  it('preflights navigation support bits', async () => {
    const old = await connect(
      viewInit({
        capabilities: capabilities({ openView: false, requestPanel: false }),
      }),
    )
    await expect(old.client.openView({ viewId: 'tutorial' })).rejects.toMatchObject({
      code: 'unsupported-message',
    })
    await expect(old.client.requestPanel('outline', 'show')).rejects.toMatchObject({
      code: 'unsupported-message',
    })
  })

  it('acknowledges disposal and rejects a pending request', async () => {
    const { transport, client } = await connect()
    const pending = client.readFile('/notes.txt')
    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'closed' } })
    expect(transport.last('plugin/dispose-ack')).toBeDefined()
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
    expect(client.closed).toBe(true)
    emitResult(
      transport,
      'shell/file-content',
      { path: '/notes.txt', version: 'v1', text: 'x' },
      'late',
    )
    await expect(client.readFile('/notes.txt')).rejects.toMatchObject({ code: 'closed' })
  })

  it('constructs a view client only from a view init', () => {
    const transport = new FakePluginTransport({ mode: 'view' })
    const gate = new MessageGate(transport)
    expect(() => new ViewClient(gate, viewInit({ mode: 'editor' as never }))).toThrowError(
      /view-mode/,
    )
    gate.close()
  })
})
