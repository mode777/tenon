// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorClient } from '@exo/plugin-sdk'
import { hashText } from '../core/project'
import { builtinBundle, type SchemaBundle } from '../core/schema'
import type { SceneDocument } from '../core/scene'
import { createEmptyScene } from '../core/scene'
import type { LoadedWorkspace } from '../core/workspace'
import { SceneEditor } from './SceneEditor'
import type { SceneViewportProps } from './Viewport'

function gameSchema(): SchemaBundle {
  return {
    id: 'com.example.game',
    version: '1.0.0',
    namespace: 'game',
    definitions: {
      'game:train': { fields: { speed: { type: 'float', default: 0 } } },
      'game:engine': { fields: { power: { type: 'float', default: 1 } } },
      'game:button': {
        fields: { label: { type: 'string', default: 'Press' } },
        events: { pressed: {} },
      },
    },
  }
}

function trainScene(): SceneDocument {
  return {
    id: 'scene_train',
    requires: ['basic3d@1.0.0', 'game@1.0.0'],
    root: 'root',
    entities: [
      { id: 'root', type: 'game:train', transform: { position: [0, 1, 0] } },
      { id: 'engine', type: 'game:engine', parent: 'root' },
      { id: 'button_anchor', type: 'basic3d:node', parent: 'root' },
    ],
    promotes: { power: { entity: 'engine', field: 'power' } },
    slots: { button_0: { entity: 'button_anchor' } },
  }
}

function levelScene(): SceneDocument {
  return {
    id: 'scene_level',
    requires: ['basic3d@1.0.0', 'game@1.0.0'],
    root: 'root',
    entities: [
      { id: 'root', type: 'basic3d:node' },
      {
        id: 'train_1',
        scene: 'scenes/train.scene.json',
        parent: 'root',
        transform: { position: [3, 0, 0] },
        props: { power: 2 },
      },
      { id: 'button_1', type: 'game:button', parent: 'train_1', slot: 'button_0' },
    ],
  }
}

function workspace(train = trainScene()): LoadedWorkspace {
  const schema = gameSchema()
  const schemaText = JSON.stringify(schema)
  const sceneText = JSON.stringify(train)
  return {
    manifest: { imports: { game: 'schemas/game.schema.json' } },
    manifestText: '{}',
    manifestError: null,
    schemaPackages: [
      {
        path: '/schemas/game.schema.json',
        source: 'local',
        text: schemaText,
        hash: hashText(schemaText),
        bundle: schema,
      },
    ],
    scenePackages: [
      {
        path: '/scenes/train.scene.json',
        text: sceneText,
        hash: hashText(sceneText),
        scene: train,
      },
    ],
    assets: ['/assets/cube.glb'],
    assetsKnown: true,
    issues: [],
  }
}

function mockClient() {
  const saveHandlers: Array<() => { text: string }> = []
  const dirty: boolean[] = []
  const requestPanel = vi.fn(async (panel: string) => ({ panel, open: true }))
  const client = {
    file: { path: '/levels/level01.scene.json' },
    instanceId: null,
    capabilities: { write: true, directoryListing: true, requestPanel: true },
    initialization: { permissions: ['workspace:write', 'events:subscribe'] },
    setDirty: (value: boolean) => dirty.push(value),
    onSaveRequest: (handler: () => { text: string }) => {
      saveHandlers.push(handler)
      return () => undefined
    },
    onSaveResult: () => () => undefined,
    onFileChanged: () => () => undefined,
    onDispose: () => () => undefined,
    onError: () => () => undefined,
    requestSave: vi.fn(),
    requestPanel,
    openFile: vi.fn(async () => ({ ok: true })),
    publishLocal: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    subscribeLocal: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    subscribe: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    unsubscribe: vi.fn(),
    onLocalEvent: () => () => undefined,
    onEvent: () => () => undefined,
    readFile: async () => ({
      path: '/levels/level01.scene.json',
      version: 'v1',
      text: JSON.stringify(levelScene()),
    }),
  } as unknown as EditorClient
  return { client, saveHandlers, dirty, requestPanel }
}

function StubViewport(_props: SceneViewportProps) {
  return <div data-testid="viewport" />
}

function renderEditor(doc = levelScene(), ws = workspace()) {
  const { client, saveHandlers, dirty, requestPanel } = mockClient()
  const result = render(
    <SceneEditor
      client={client}
      initialDoc={doc}
      scenePath="/levels/level01.scene.json"
      levelMode
      canWrite
      workspace={ws}
      Viewport={StubViewport}
    />,
  )
  return { ...result, client, saveHandlers, dirty, requestPanel }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SceneEditor', () => {
  it('renders the hierarchy, palette, and level badge', () => {
    renderEditor()
    expect(screen.getByText('level01.scene.json')).toBeTruthy()
    expect(screen.getByText('Level')).toBeTruthy()
    expect(screen.getByRole('button', { name: /train_1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /button_1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /game:engine/ })).toBeTruthy()
    expect(screen.getByTestId('viewport')).toBeTruthy()
    expect(screen.queryByLabelText('Entity name')).toBeNull()
    expect(screen.queryByRole('button', { name: /Public surface/ })).toBeNull()
  })

  it('reveals the shell inspector and inspection panels', async () => {
    const user = userEvent.setup()
    const { requestPanel } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Inspector' }))
    expect(requestPanel).toHaveBeenCalledWith('tenon.scene.inspector', 'show')
    await user.click(screen.getByRole('button', { name: /Inspection/ }))
    expect(requestPanel).toHaveBeenCalledWith('tenon.scene.inspection', 'show')
  })

  it('adds an entity from the palette and reports dirty', async () => {
    const user = userEvent.setup()
    const { dirty, saveHandlers } = renderEditor()
    await user.click(screen.getByRole('button', { name: /game:engine/ }))
    expect((await screen.findAllByText('engine_1')).length).toBeGreaterThan(0)
    expect(dirty).toContain(true)
    expect(saveHandlers[0]().text).toContain('engine_1')
  })

  it('undoes an edit', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: /game:engine/ }))
    expect((await screen.findAllByText('engine_1')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.queryAllByText('engine_1')).toHaveLength(0))
  })

  it('does not expose scene instance internals in the host hierarchy', () => {
    renderEditor()
    expect(screen.queryByText('engine')).toBeNull()
    expect(screen.queryByText('button_anchor')).toBeNull()
  })

  it('adds the schema requirement when placing a definition from another bundle', async () => {
    const user = userEvent.setup()
    const { saveHandlers } = renderEditor(createEmptyScene())
    await user.click(screen.getByRole('button', { name: /game:engine/ }))
    const saved = saveHandlers[0]().text
    expect(saved).toContain('game@1.0.0')
  })

  it('places a glb asset as a mesh entity', async () => {
    const user = userEvent.setup()
    const { saveHandlers } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Assets' }))
    await user.click(await screen.findByRole('button', { name: 'Place' }))
    expect((await screen.findAllByText('mesh_1')).length).toBeGreaterThan(0)
    expect(saveHandlers[0]().text).toContain('"mesh": "assets/cube.glb"')
  })

  it('disables editing in a read-only workspace', () => {
    const { client } = mockClient()
    render(
      <SceneEditor
        client={client}
        initialDoc={levelScene()}
        scenePath="/levels/level01.scene.json"
        levelMode
        canWrite={false}
        workspace={workspace()}
        Viewport={StubViewport}
      />,
    )
    expect((screen.getByRole('button', { name: /game:engine/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
