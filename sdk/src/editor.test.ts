import { describe, expect, it, vi } from 'vitest'
import { connectPlugin } from './handshake'
import type { EditorInit, EventTopic, SaveResult } from './protocol'
import { FakePluginTransport } from './testing'

const SHELL_ORIGIN = 'https://editor.example.com'
const SESSION_ID = 'session-1'

function init(overrides: Partial<EditorInit> = {}): EditorInit {
  return {
    protocolVersion: '1',
    mode: 'editor',
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '1.0.0' },
    shell: { version: '0.1.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark',
    permissions: ['workspace:read', 'workspace:write', 'events:subscribe'],
    locale: 'en',
    settings: { 'template.greeting': 'hello' },
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

describe('editor client', () => {
  it('exposes metadata without reading content', async () => {
    const { transport, editor } = await connect()
    expect(editor.file).toMatchObject({ path: '/notes.template.txt', version: 'v1' })
    expect(editor.capabilities).toEqual({
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
    })
    expect(editor.settings).toEqual({ 'template.greeting': 'hello' })
    expect(transport.posted.filter((item) => item.type === 'plugin/request-file')).toHaveLength(0)
  })

  it('reads text and binary content by correlated id', async () => {
    const { transport, editor } = await connect()
    const text = editor.readFile('/notes.template.txt')
    const textId = postedId(transport, 'plugin/request-file')
    transport.emit({
      exo: 1,
      type: 'shell/file-content',
      replyTo: textId,
      payload: { path: '/notes.template.txt', version: 'v1', text: 'hello' },
    })
    await expect(text).resolves.toEqual({
      path: '/notes.template.txt',
      version: 'v1',
      text: 'hello',
    })

    const bytes = new Uint8Array([1, 2, 3]).buffer
    const binary = editor.readFile('./other.bin', 'binary')
    const binaryId = postedId(transport, 'plugin/request-file')
    expect(transport.last('plugin/request-file')?.payload).toEqual({
      path: './other.bin',
      encoding: 'binary',
    })
    transport.emit({
      exo: 1,
      type: 'shell/file-content',
      replyTo: binaryId,
      payload: { path: '/other.bin', version: 'v2', bytes },
    })
    await expect(binary).resolves.toEqual({ path: '/other.bin', version: 'v2', bytes })
  })

  it('keeps an unrelated request pending after one error', async () => {
    const { transport, editor } = await connect()
    const first = editor.readFile('/a.txt').catch((error: unknown) => error)
    const firstId = postedId(transport, 'plugin/request-file')
    const second = editor.readFile('/b.txt')
    const secondId = postedId(transport, 'plugin/request-file')

    transport.emit({
      exo: 1,
      type: 'shell/error',
      replyTo: firstId,
      payload: { code: 'permission-denied', message: 'no' },
    })
    await expect(first).resolves.toMatchObject({ code: 'permission-denied' })
    transport.emit({
      exo: 1,
      type: 'shell/file-content',
      replyTo: secondId,
      payload: { path: '/b.txt', version: 'v1', text: 'b' },
    })
    await expect(second).resolves.toMatchObject({ text: 'b' })
  })

  it('caps in-flight requests', async () => {
    const { transport, editor } = await connect()
    const pending: Promise<unknown>[] = []
    for (let index = 0; index < 64; index += 1) {
      pending.push(editor.readFile(`/file-${index}.txt`).catch(() => undefined))
    }
    await expect(editor.readFile('/overflow.txt')).rejects.toMatchObject({ code: 'rate-limited' })
    expect(transport.posted.filter((item) => item.type === 'plugin/request-file')).toHaveLength(64)
    editor.close()
    await Promise.all(pending)
  })

  it('reports dirty state', async () => {
    const { transport, editor } = await connect()
    editor.setDirty(true)
    expect(transport.last('plugin/dirty')?.payload).toEqual({ dirty: true })
    editor.setDirty(false)
    expect(transport.last('plugin/dirty')?.payload).toEqual({ dirty: false })
  })

  it('sends one id-less save intent and nothing after close', async () => {
    const { transport, editor } = await connect()
    editor.requestSave()
    expect(transport.last('plugin/request-save')).toEqual({ exo: 1, type: 'plugin/request-save' })
    expect(transport.posted.filter((message) => message.type === 'plugin/save-content')).toEqual([])

    editor.close()
    const posted = transport.posted.length
    editor.requestSave()
    expect(transport.posted).toHaveLength(posted)
  })

  it('answers a save request and exposes the result', async () => {
    const { transport, editor } = await connect()
    editor.onSaveRequest(() => ({ text: 'saved text' }))
    const results: SaveResult[] = []
    editor.onSaveResult((result) => results.push(result))

    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-1', payload: {} })
    await Promise.resolve()
    expect(transport.last('plugin/save-content')).toEqual({
      exo: 1,
      type: 'plugin/save-content',
      replyTo: 'save-1',
      payload: { text: 'saved text' },
    })

    transport.emit({
      exo: 1,
      type: 'shell/save-result',
      replyTo: 'save-1',
      payload: { ok: true, version: 'v2' },
    })
    expect(results).toEqual([{ ok: true, version: 'v2' }])
    expect(editor.file.version).toBe('v2')
  })

  it('does not write when the save handler throws or is absent', async () => {
    const { transport, editor } = await connect()
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-0', payload: {} })
    await Promise.resolve()
    expect(transport.last('plugin/save-content')).toBeUndefined()

    editor.onSaveRequest(() => {
      throw new Error('no content')
    })
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-1', payload: {} })
    await Promise.resolve()
    expect(transport.last('plugin/save-content')).toBeUndefined()

    editor.onSaveRequest(() => ({ text: 'ok' }))
    const off = editor.onSaveRequest(() => ({ text: 'first' }))
    off()
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-2', payload: {} })
    await Promise.resolve()
    expect(transport.last('plugin/save-content')?.replyTo).toBe('save-2')
  })

  it('surfaces a failed save without changing the version', async () => {
    const { transport, editor } = await connect()
    editor.onSaveRequest(() => ({ text: 'saved' }))
    const results: SaveResult[] = []
    editor.onSaveResult((result) => results.push(result))
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-1', payload: {} })
    await Promise.resolve()
    transport.emit({
      exo: 1,
      type: 'shell/save-result',
      replyTo: 'save-1',
      payload: { ok: false, code: 'conflict' },
    })
    expect(results).toEqual([{ ok: false, code: 'conflict' }])
    expect(editor.file.version).toBe('v1')
  })

  it('delivers external changes without changing dirty state', async () => {
    const { transport, editor } = await connect()
    const changes: unknown[] = []
    editor.onFileChanged((change) => changes.push(change))
    transport.emit({
      exo: 1,
      type: 'shell/file-changed',
      payload: { path: '/notes.template.txt', kind: 'changed', version: 'v2' },
    })
    expect(changes).toEqual([{ path: '/notes.template.txt', kind: 'changed', version: 'v2' }])
    expect(transport.last('plugin/dirty')).toBeUndefined()
  })

  it('acknowledges dispose once, rejects pending work and ignores later messages', async () => {
    const { transport, editor } = await connect()
    const pending = editor.readFile('/a.txt').catch((error: unknown) => error)
    const reasons: string[] = []
    editor.onDispose((reason) => reasons.push(reason))
    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'workspace-switch' } })
    await expect(pending).resolves.toMatchObject({ code: 'closed' })
    expect(reasons).toEqual(['workspace-switch'])
    expect(editor.closed).toBe(true)
    expect(transport.posted.filter((item) => item.type === 'plugin/dispose-ack')).toHaveLength(1)

    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'closed' } })
    expect(transport.posted.filter((item) => item.type === 'plugin/dispose-ack')).toHaveLength(1)
    expect(transport.last('plugin/request-file')).toBeDefined()
    expect(transport.posted.filter((item) => item.type === 'plugin/request-file')).toHaveLength(1)
  })

  it('subscribes, delivers typed events and contains a throwing listener', async () => {
    const { transport, editor } = await connect()
    const subscription = editor.subscribe('theme/changed')
    const subscribeId = postedId(transport, 'plugin/subscribe')
    transport.emit({
      exo: 1,
      type: 'shell/subscribed',
      replyTo: subscribeId,
      payload: { topic: 'theme/changed', seq: 3 },
    })
    await expect(subscription).resolves.toEqual({ topic: 'theme/changed', seq: 3 })

    const seen: unknown[] = []
    editor.onEvent('theme/changed', (event) => seen.push(event))
    editor.onEvent('theme/changed', () => {
      throw new Error('listener')
    })
    transport.emit({
      exo: 1,
      type: 'shell/event',
      payload: { topic: 'theme/changed', seq: 4, payload: { theme: 'light' } },
    })
    transport.emit({
      exo: 1,
      type: 'shell/event',
      payload: { topic: 'theme/changed', seq: 5, payload: { theme: 'dark' } },
    })
    expect(seen).toEqual([
      { topic: 'theme/changed', seq: 4, payload: { theme: 'light' } },
      { topic: 'theme/changed', seq: 5, payload: { theme: 'dark' } },
    ])
  })

  it('rejects unsupported topics and missing subscriptions', async () => {
    const { transport, editor } = await connect()
    const unsupported = editor.subscribe('not/a-topic' as EventTopic)
    const unsupportedId = postedId(transport, 'plugin/subscribe')
    transport.emit({
      exo: 1,
      type: 'shell/subscribed',
      replyTo: unsupportedId,
      payload: { topic: 'not/a-topic', code: 'unsupported-topic' },
    })
    await expect(unsupported).rejects.toMatchObject({ code: 'unsupported-topic' })

    const denied = editor.subscribe('config/changed')
    const deniedId = postedId(transport, 'plugin/subscribe')
    transport.emit({
      exo: 1,
      type: 'shell/error',
      replyTo: deniedId,
      payload: { code: 'permission-denied' },
    })
    await expect(denied).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('unsubscribes locally and immediately', async () => {
    const { transport, editor } = await connect()
    const subscription = editor.subscribe('theme/changed')
    const subscribeId = postedId(transport, 'plugin/subscribe')
    transport.emit({
      exo: 1,
      type: 'shell/subscribed',
      replyTo: subscribeId,
      payload: { topic: 'theme/changed', seq: 0 },
    })
    await subscription
    const seen: unknown[] = []
    editor.onEvent('theme/changed', (event) => seen.push(event))
    editor.unsubscribe('theme/changed')
    expect(transport.last('plugin/unsubscribe')?.payload).toEqual({ topic: 'theme/changed' })
    transport.emit({
      exo: 1,
      type: 'shell/event',
      payload: { topic: 'theme/changed', seq: 1, payload: { theme: 'light' } },
    })
    expect(seen).toEqual([])
  })

  it('publishes a local event and resolves from the acknowledgement', async () => {
    const { transport, editor } = await connect()
    const published = editor.publishLocal('local/state', { ready: true })
    const id = postedId(transport, 'plugin/publish')
    expect(transport.last('plugin/publish')?.payload).toEqual({
      topic: 'local/state',
      payload: { ready: true },
    })
    transport.emit({
      exo: 1,
      type: 'shell/published',
      replyTo: id,
      payload: { topic: 'local/state', seq: 7 },
    })
    await expect(published).resolves.toEqual({ topic: 'local/state', seq: 7 })
  })

  it('subscribes to a local topic and delivers from and payload unchanged', async () => {
    const { transport, editor } = await connect()
    const subscription = editor.subscribeLocal('local/state')
    const subscribeId = postedId(transport, 'plugin/subscribe')
    expect(transport.last('plugin/subscribe')?.payload).toEqual({ topic: 'local/state' })
    transport.emit({
      exo: 1,
      type: 'shell/subscribed',
      replyTo: subscribeId,
      payload: { topic: 'local/state', seq: 2 },
    })
    await expect(subscription).resolves.toEqual({ topic: 'local/state', seq: 2 })

    const seen: unknown[] = []
    editor.onLocalEvent('local/state', (event) => seen.push(event))
    editor.onLocalEvent('local/state', () => {
      throw new Error('local listener')
    })
    transport.emit({
      exo: 1,
      type: 'shell/event',
      payload: { topic: 'local/state', seq: 3, from: 'frame-a', payload: { n: 1 } },
    })
    expect(seen).toEqual([{ topic: 'local/state', seq: 3, from: 'frame-a', payload: { n: 1 } }])

    editor.unsubscribe('local/state')
    expect(transport.last('plugin/unsubscribe')?.payload).toEqual({ topic: 'local/state' })
    transport.emit({
      exo: 1,
      type: 'shell/event',
      payload: { topic: 'local/state', seq: 4, from: 'frame-b', payload: { n: 2 } },
    })
    expect(seen).toHaveLength(1)
  })

  it('preflights local support, permission, topic form and size without sending', async () => {
    const old = await connect({
      capabilities: {
        read: true,
        write: true,
        requestFiles: true,
        filePicker: true,
        createFile: true,
        directoryListing: true,
        localEvents: false,
        openFile: true,
        openView: true,
        requestPanel: true,
        commands: true,
      },
    })
    await expect(old.editor.publishLocal('local/state', {})).rejects.toMatchObject({
      code: 'unsupported-message',
    })
    expect(old.transport.posted.filter((item) => item.type === 'plugin/publish')).toHaveLength(0)
    expect(old.editor.capabilities.localEvents).toBe(false)

    const denied = await connect({ permissions: ['workspace:read'] })
    await expect(denied.editor.publishLocal('local/state', {})).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(denied.editor.subscribeLocal('local/state')).rejects.toMatchObject({
      code: 'permission-denied',
    })

    const { transport, editor } = await connect()
    await expect(editor.publishLocal('theme/changed', {})).rejects.toMatchObject({
      code: 'permission-denied',
    })
    for (const topic of ['local/', 'local/State', 'local/a/b']) {
      await expect(editor.subscribeLocal(topic as 'local/state')).rejects.toMatchObject({
        code: 'unsupported-topic',
      })
    }
    await expect(editor.publishLocal('local/state', 'x'.repeat(1024 * 1024))).rejects.toMatchObject(
      { code: 'too-large' },
    )
    expect(transport.posted.filter((item) => item.type === 'plugin/publish')).toHaveLength(0)
    expect(transport.posted.filter((item) => item.type === 'plugin/subscribe')).toHaveLength(0)
  })

  it('rejects pending local calls on disposal', async () => {
    const { transport, editor } = await connect()
    const publish = editor.publishLocal('local/state', {})
    const subscribe = editor.subscribeLocal('local/state')
    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'closed' } })
    await expect(publish).rejects.toMatchObject({ code: 'closed' })
    await expect(subscribe).rejects.toMatchObject({ code: 'closed' })
  })

  it('rejects a malformed publish acknowledgement', async () => {
    const { transport, editor } = await connect()
    const pending = editor.publishLocal('local/state', {})
    const id = postedId(transport, 'plugin/publish')
    transport.emit({
      exo: 1,
      type: 'shell/published',
      replyTo: id,
      payload: { topic: 'theme/changed', seq: 1 },
    })
    await expect(pending).rejects.toMatchObject({ code: 'protocol-violation' })
  })

  it('surfaces unsolicited errors without closing', async () => {
    const { transport, editor } = await connect()
    const errors: unknown[] = []
    editor.onError((error) => errors.push(error))
    transport.emit({ exo: 1, type: 'shell/error', payload: { code: 'rate-limited' } })
    expect(errors).toEqual([{ code: 'rate-limited' }])
    expect(editor.closed).toBe(false)
  })

  it('contains a throwing save-result listener', async () => {
    const { transport, editor } = await connect()
    editor.onSaveRequest(() => ({ text: 'saved' }))
    editor.onSaveResult(() => {
      throw new Error('listener')
    })
    const later = vi.fn()
    editor.onSaveResult(later)
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-1', payload: {} })
    await Promise.resolve()
    transport.emit({
      exo: 1,
      type: 'shell/save-result',
      replyTo: 'save-1',
      payload: { ok: true, version: 'v2' },
    })
    expect(later).toHaveBeenCalledWith({ ok: true, version: 'v2' })
  })

  it('requests workspace files and resolves the selected paths', async () => {
    const { transport, editor } = await connect()
    const pending = editor.requestFiles({ multiple: true, directory: '/assets' })
    const id = postedId(transport, 'plugin/request-files')
    expect(transport.last('plugin/request-files')?.payload).toEqual({
      multiple: true,
      directory: '/assets',
    })
    transport.emit({
      exo: 1,
      type: 'shell/files-selected',
      replyTo: id,
      payload: { paths: ['/assets/a.png', '/assets/b.png'] },
    })
    await expect(pending).resolves.toEqual(['/assets/a.png', '/assets/b.png'])
  })

  it('resolves a cancelled picker with an empty array', async () => {
    const { transport, editor } = await connect()
    const pending = editor.requestFiles()
    const id = postedId(transport, 'plugin/request-files')
    transport.emit({
      exo: 1,
      type: 'shell/files-selected',
      replyTo: id,
      payload: { paths: [] },
    })
    await expect(pending).resolves.toEqual([])
  })

  it('rejects a second pending picker locally', async () => {
    const { transport, editor } = await connect()
    const first = editor.requestFiles()
    const id = postedId(transport, 'plugin/request-files')
    await expect(editor.requestFiles()).rejects.toMatchObject({ code: 'rate-limited' })
    expect(transport.posted.filter((item) => item.type === 'plugin/request-files')).toHaveLength(1)
    transport.emit({
      exo: 1,
      type: 'shell/files-selected',
      replyTo: id,
      payload: { paths: [] },
    })
    await expect(first).resolves.toEqual([])
  })

  it('preflights old shells and missing read permission without sending', async () => {
    const oldCapabilities = {
      read: true,
      write: true,
      requestFiles: true,
    } as unknown as EditorInit['capabilities']
    const old = await connect({ capabilities: oldCapabilities })
    expect(old.editor.capabilities.filePicker).toBe(false)
    await expect(old.editor.requestFiles()).rejects.toMatchObject({ code: 'unsupported-message' })
    expect(
      old.transport.posted.filter((item) => item.type === 'plugin/request-files'),
    ).toHaveLength(0)

    const denied = await connect({
      capabilities: {
        read: true,
        write: false,
        requestFiles: false,
        filePicker: true,
        createFile: true,
        directoryListing: true,
        localEvents: true,
        openFile: true,
        openView: true,
        requestPanel: true,
        commands: true,
      },
    })
    await expect(denied.editor.requestFiles()).rejects.toMatchObject({ code: 'permission-denied' })
    expect(
      denied.transport.posted.filter((item) => item.type === 'plugin/request-files'),
    ).toHaveLength(0)
  })

  it('rejects correlated errors and malformed selection replies', async () => {
    const { transport, editor } = await connect()
    const denied = editor.requestFiles()
    const deniedId = postedId(transport, 'plugin/request-files')
    transport.emit({
      exo: 1,
      type: 'shell/error',
      replyTo: deniedId,
      payload: { code: 'permission-denied' },
    })
    await expect(denied).rejects.toMatchObject({ code: 'permission-denied' })

    const malformed = editor.requestFiles()
    const malformedId = postedId(transport, 'plugin/request-files')
    transport.emit({
      exo: 1,
      type: 'shell/files-selected',
      replyTo: malformedId,
      payload: { paths: [1] },
    })
    await expect(malformed).rejects.toMatchObject({ code: 'protocol-violation' })
  })

  it('rejects a pending picker on disposal', async () => {
    const { transport, editor } = await connect()
    const pending = editor.requestFiles()
    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'closed' } })
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
  })

  it('lists a directory and passes the opaque cursor unchanged', async () => {
    const { transport, editor } = await connect({
      permissions: ['workspace:read', 'workspace:list'],
    })
    const first = editor.listDirectory('/assets')
    const firstId = postedId(transport, 'plugin/request-list')
    expect(transport.last('plugin/request-list')?.payload).toEqual({ path: '/assets' })
    transport.emit({
      exo: 1,
      type: 'shell/list-result',
      replyTo: firstId,
      payload: {
        entries: [
          { path: '/assets/sub', kind: 'directory' },
          { path: '/assets/a.txt', kind: 'file', size: 4 },
        ],
        nextCursor: 'v1.snapshot.2',
      },
    })
    await expect(first).resolves.toEqual({
      entries: [
        { path: '/assets/sub', kind: 'directory' },
        { path: '/assets/a.txt', kind: 'file', size: 4 },
      ],
      nextCursor: 'v1.snapshot.2',
    })

    const second = editor.listDirectory('/assets', { cursor: 'v1.snapshot.2' })
    const secondId = postedId(transport, 'plugin/request-list')
    expect(transport.last('plugin/request-list')?.payload).toEqual({
      path: '/assets',
      cursor: 'v1.snapshot.2',
    })
    transport.emit({
      exo: 1,
      type: 'shell/list-result',
      replyTo: secondId,
      payload: { entries: [] },
    })
    await expect(second).resolves.toEqual({ entries: [] })
  })

  it('preflights listing support and permission without sending', async () => {
    const old = await connect({
      permissions: ['workspace:read', 'workspace:list'],
      capabilities: {
        read: true,
        write: true,
        requestFiles: true,
        filePicker: true,
        createFile: true,
        directoryListing: false,
        localEvents: true,
        openFile: true,
        openView: true,
        requestPanel: true,
        commands: true,
      },
    })
    await expect(old.editor.listDirectory('/')).rejects.toMatchObject({
      code: 'unsupported-message',
    })
    expect(old.transport.posted.filter((item) => item.type === 'plugin/request-list')).toHaveLength(
      0,
    )

    const denied = await connect({ permissions: ['workspace:read'] })
    await expect(denied.editor.listDirectory('/')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(
      denied.transport.posted.filter((item) => item.type === 'plugin/request-list'),
    ).toHaveLength(0)
  })

  it('rejects a listing with the shell error code and leaves other requests pending', async () => {
    const { transport, editor } = await connect({
      permissions: ['workspace:read', 'workspace:list'],
    })
    const listing = editor.listDirectory('/notes.txt')
    const listingId = postedId(transport, 'plugin/request-list')
    transport.emit({
      exo: 1,
      type: 'shell/error',
      replyTo: listingId,
      payload: { code: 'not-a-directory' },
    })
    await expect(listing).rejects.toMatchObject({ code: 'not-a-directory' })
  })

  it('rejects a malformed listing page and entry shape', async () => {
    const { transport, editor } = await connect({
      permissions: ['workspace:read', 'workspace:list'],
    })
    const cases: unknown[] = [
      {},
      { entries: [1] },
      { entries: [{ path: '/a', kind: 'file' }] },
      { entries: [{ path: '/a', kind: 'file', size: 1, mtime: 1 }] },
      { entries: [{ path: '/a', kind: 'directory', size: 1 }] },
      { entries: [{ path: '/a', kind: 'other' }] },
      { entries: [], nextCursor: 1 },
      { entries: [], nextCursor: '' },
    ]
    for (const payload of cases) {
      const pending = editor.listDirectory('/')
      const id = postedId(transport, 'plugin/request-list')
      transport.emit({ exo: 1, type: 'shell/list-result', replyTo: id, payload })
      await expect(pending).rejects.toMatchObject({ code: 'protocol-violation' })
    }
  })

  it('rejects a pending listing on disposal', async () => {
    const { transport, editor } = await connect({
      permissions: ['workspace:read', 'workspace:list'],
    })
    const pending = editor.listDirectory('/')
    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'closed' } })
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
  })
})
