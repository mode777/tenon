// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import type { EditorClient } from '@exo/plugin-sdk'
import { hashText } from '../core/project'
import type { SchemaBundle } from '../core/schema'
import type { SceneDocument } from '../core/scene'
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
        scene: '/scenes/train.scene.json',
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
  const undoListeners = new Set<() => void>()
  const redoListeners = new Set<() => void>()
  const requestPanel = vi.fn(async (panel: string) => ({ panel, open: true }))
  const requestSave = vi.fn()
  const client = {
    file: { path: '/levels/level01.scene.json' },
    instanceId: 'editor-1',
    capabilities: { write: true, directoryListing: true, requestPanel: true },
    initialization: { permissions: ['workspace:write', 'events:subscribe'] },
    setDirty: (value: boolean) => dirty.push(value),
    onSaveRequest: (handler: () => { text: string }) => {
      saveHandlers.push(handler)
      return () => undefined
    },
    onSaveResult: () => () => undefined,
    onUndoRequest: (listener: () => void) => {
      undoListeners.add(listener)
      return () => {
        undoListeners.delete(listener)
      }
    },
    onRedoRequest: (listener: () => void) => {
      redoListeners.add(listener)
      return () => {
        redoListeners.delete(listener)
      }
    },
    onFileChanged: () => () => undefined,
    onDispose: () => () => undefined,
    onError: () => () => undefined,
    requestSave,
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
    listDirectory: async (path: string) => {
      if (path === '/assets') {
        return { entries: [{ path: '/assets/cube.glb', kind: 'file' }] }
      }
      if (path === '/scenes') {
        return { entries: [{ path: '/scenes/train.scene.json', kind: 'file' }] }
      }
      return { entries: [] }
    },
  } as unknown as EditorClient
  return {
    client,
    saveHandlers,
    dirty,
    requestPanel,
    requestSave,
    emitUndo: () => {
      for (const listener of [...undoListeners]) listener()
    },
    emitRedo: () => {
      for (const listener of [...redoListeners]) listener()
    },
  }
}

function StubViewport(_props: SceneViewportProps) {
  return <div data-testid="viewport" />
}

function SelectionViewport(props: SceneViewportProps) {
  return (
    <div data-testid="viewport">
      <span data-testid="selection">{props.selection ?? 'none'}</span>
      <button type="button" onClick={() => props.onSelect('button_1')}>
        Select button
      </button>
      <button
        type="button"
        onClick={() =>
          props.onTransform('button_1', {
            position: [2, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          })
        }
      >
        Move button
      </button>
    </div>
  )
}

function renderEditor(
  doc = levelScene(),
  ws = workspace(),
  canWrite = true,
  Viewport: ComponentType<SceneViewportProps> = StubViewport,
) {
  const { client, saveHandlers, dirty, requestPanel, requestSave, emitUndo, emitRedo } =
    mockClient()
  const result = render(
    <SceneEditor
      client={client}
      initialDoc={doc}
      scenePath="/levels/level01.scene.json"
      levelMode
      canWrite={canWrite}
      workspace={ws}
      Viewport={Viewport}
    />,
  )
  return { ...result, client, saveHandlers, dirty, requestPanel, requestSave, emitUndo, emitRedo }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SceneEditor', () => {
  it('renders the viewport, toolbar, and level badge without the in-frame library', () => {
    renderEditor()
    expect(screen.getByText('level01.scene.json')).toBeTruthy()
    expect(screen.getByText('Level')).toBeTruthy()
    expect(screen.getByTestId('viewport')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hierarchy' })).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entities' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Assets' })).toBeNull()
  })

  it('reveals the hierarchy, inspector, and inspection panels', async () => {
    const user = userEvent.setup()
    const { requestPanel } = renderEditor()
    await waitFor(() =>
      expect(requestPanel).toHaveBeenCalledWith('tenon.scene.hierarchy', 'show'),
    )
    await user.click(screen.getByRole('button', { name: 'Hierarchy' }))
    expect(requestPanel).toHaveBeenCalledWith('tenon.scene.hierarchy', 'show')
    await user.click(screen.getByRole('button', { name: 'Inspector' }))
    expect(requestPanel).toHaveBeenCalledWith('tenon.scene.inspector', 'show')
    await user.click(screen.getByRole('button', { name: /Inspection/ }))
    expect(requestPanel).toHaveBeenCalledWith('tenon.scene.inspection', 'show')
  })

  it('answers a save request with the current scene document', () => {
    const { saveHandlers } = renderEditor()
    const saved = saveHandlers[0]().text
    expect(saved).toContain('scene_level')
    expect(saved).toContain('train_1')
  })

  it('keeps shell save and dirty behavior in the editor frame', async () => {
    const user = userEvent.setup()
    const { requestSave, dirty } = renderEditor()
    await waitFor(() => expect(dirty.at(-1)).toBe(false))
    await user.keyboard('{Control>}s{/Control}')
    expect(requestSave).toHaveBeenCalled()
  })

  it('restores selection when undoing a delete', async () => {
    const user = userEvent.setup()
    renderEditor(levelScene(), workspace(), true, SelectionViewport)

    await user.click(screen.getByRole('button', { name: 'Select button' }))
    expect(screen.getByTestId('selection').textContent).toBe('button_1')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByTestId('selection').textContent).toBe('none')

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('selection').textContent).toBe('button_1')
  })

  it('undoes a viewport transform as one history step', async () => {
    const user = userEvent.setup()
    const { saveHandlers, dirty } = renderEditor(
      levelScene(),
      workspace(),
      true,
      SelectionViewport,
    )

    await user.click(screen.getByRole('button', { name: 'Select button' }))
    await user.click(screen.getByRole('button', { name: 'Move button' }))
    const moved = JSON.parse(saveHandlers[0]().text)
    expect(moved.entities.find((entity: { id: string }) => entity.id === 'button_1').transform)
      .toEqual({ position: [2, 0, 0] })

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    const undone = JSON.parse(saveHandlers[0]().text)
    expect(undone.entities.find((entity: { id: string }) => entity.id === 'button_1').transform)
      .toBeUndefined()
    expect(screen.getByTestId('selection').textContent).toBe('button_1')
    await waitFor(() => expect(dirty.at(-1)).toBe(false))
  })

  it('applies shell undo and redo intents', async () => {
    const user = userEvent.setup()
    const { emitUndo, emitRedo } = renderEditor(levelScene(), workspace(), true, SelectionViewport)

    await user.click(screen.getByRole('button', { name: 'Select button' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByTestId('selection').textContent).toBe('none')

    act(() => emitUndo())
    expect(screen.getByTestId('selection').textContent).toBe('button_1')

    act(() => emitRedo())
    expect(screen.getByTestId('selection').textContent).toBe('none')
  })

  it('handles undo and redo keyboard shortcuts', async () => {
    const user = userEvent.setup()
    renderEditor(levelScene(), workspace(), true, SelectionViewport)

    await user.click(screen.getByRole('button', { name: 'Select button' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByTestId('selection').textContent).toBe('none')

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByTestId('selection').textContent).toBe('button_1')

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(screen.getByTestId('selection').textContent).toBe('none')
  })

  it('disables editing controls in a read-only workspace', () => {
    renderEditor(levelScene(), workspace(), false)
    expect((screen.getByRole('button', { name: 'Duplicate' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
