// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorClient } from '@exo/plugin-sdk'
import { hashText, type ProjectManifest } from '../core/project'
import type { SchemaBundle } from '../core/schema'
import type { SceneDocument } from '../core/scene'
import type { LoadedWorkspace } from '../core/workspace'
import { ProjectEditor } from './ProjectEditor'

function gameSchema(): SchemaBundle {
  return {
    id: 'com.example.game',
    version: '1.0.0',
    namespace: 'game',
    definitions: {
      'game:train': { fields: { speed: { type: 'float', default: 0 } } },
    },
  }
}

function trainScene(): SceneDocument {
  return {
    id: 'scene_train',
    requires: ['basic3d@1.0.0', 'game@1.0.0'],
    root: 'root',
    entities: [{ id: 'root', type: 'game:train' }],
  }
}

function workspace(): LoadedWorkspace {
  const schema = gameSchema()
  const scene = trainScene()
  const schemaText = JSON.stringify(schema)
  const sceneText = JSON.stringify(scene)
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
        scene,
      },
    ],
    assets: [],
    assetsKnown: true,
    issues: [],
  }
}

function mockClient() {
  const saveHandlers: Array<() => { text: string }> = []
  const saveResultListeners: Array<(result: { ok: boolean; version?: string }) => void> = []
  const fileChangedListeners: Array<(change: { kind: string; path: string }) => void> = []
  const dirty: boolean[] = []
  const undoListeners = new Set<() => void>()
  const redoListeners = new Set<() => void>()
  const client = {
    file: { path: '/project.json' },
    capabilities: { write: true },
    initialization: { permissions: ['workspace:write'] },
    setDirty: (value: boolean) => dirty.push(value),
    onSaveRequest: (handler: () => { text: string }) => {
      saveHandlers.push(handler)
      return () => undefined
    },
    onSaveResult: (listener: (result: { ok: boolean; version?: string }) => void) => {
      saveResultListeners.push(listener)
      return () => {
        const index = saveResultListeners.indexOf(listener)
        if (index >= 0) saveResultListeners.splice(index, 1)
      }
    },
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
    onFileChanged: (listener: (change: { kind: string; path: string }) => void) => {
      fileChangedListeners.push(listener)
      return () => {
        const index = fileChangedListeners.indexOf(listener)
        if (index >= 0) fileChangedListeners.splice(index, 1)
      }
    },
    onDispose: () => () => undefined,
    onError: () => () => undefined,
    requestSave: vi.fn(),
    openFile: vi.fn(async () => ({ ok: true })),
    readFile: async () => ({
      path: '/project.json',
      version: 'v1',
      text: JSON.stringify({ imports: { game: 'schemas/game.schema.json' } }),
    }),
  } as unknown as EditorClient
  return {
    client,
    saveHandlers,
    dirty,
    emitUndo: () => {
      for (const listener of [...undoListeners]) listener()
    },
    emitRedo: () => {
      for (const listener of [...redoListeners]) listener()
    },
    emitSaveResult: (result: { ok: boolean; version?: string }) => {
      for (const listener of [...saveResultListeners]) listener(result)
    },
    emitFileChanged: (change: { kind: string; path: string }) => {
      for (const listener of [...fileChangedListeners]) listener(change)
    },
  }
}

function renderEditor(
  manifest: ProjectManifest = { imports: { game: 'schemas/game.schema.json' } },
  canWrite = true,
  ws = workspace(),
) {
  const {
    client,
    saveHandlers,
    dirty,
    emitUndo,
    emitRedo,
    emitSaveResult,
    emitFileChanged,
  } = mockClient()
  const result = render(
    <ProjectEditor
      client={client}
      initialManifest={manifest}
      canWrite={canWrite}
      workspace={ws}
    />,
  )
  return {
    ...result,
    client,
    saveHandlers,
    dirty,
    emitUndo,
    emitRedo,
    emitSaveResult,
    emitFileChanged,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProjectEditor', () => {
  it('shows import map, resolved schemas, and readiness', () => {
    renderEditor()
    expect(screen.getByText('Project resolves')).toBeTruthy()
    expect(screen.getByDisplayValue('schemas/game.schema.json')).toBeTruthy()
    expect(screen.getAllByText('basic3d').length).toBeGreaterThan(0)
    expect(screen.getAllByText('game').length).toBeGreaterThan(0)
  })

  it('edits a location on blur and reports dirty', async () => {
    const user = userEvent.setup()
    const { dirty } = renderEditor()
    const input = screen.getByLabelText('Location for game')
    await user.clear(input)
    await user.type(input, 'schemas/missing.schema.json')
    expect(dirty.at(-1)).toBe(false)
    await user.tab()
    await waitFor(() => expect(dirty.at(-1)).toBe(true))
    expect(await screen.findByText(/blocking error/)).toBeTruthy()
  })

  it('undoes and redoes a location edit in one step', async () => {
    const user = userEvent.setup()
    const { dirty } = renderEditor()
    const input = screen.getByLabelText('Location for game')
    await user.clear(input)
    await user.type(input, 'schemas/other.schema.json')
    await user.tab()

    expect(screen.getByDisplayValue('schemas/other.schema.json')).toBeTruthy()
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    await user.click(undo)
    expect(screen.getByDisplayValue('schemas/game.schema.json')).toBeTruthy()
    await waitFor(() => expect(dirty.at(-1)).toBe(false))

    await user.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByDisplayValue('schemas/other.schema.json')).toBeTruthy()
    await waitFor(() => expect(dirty.at(-1)).toBe(true))
  })

  it('applies shell undo and redo intents', async () => {
    const user = userEvent.setup()
    const { emitUndo, emitRedo } = renderEditor()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByDisplayValue('schemas/game.schema.json')).toBeFalsy()

    act(() => emitUndo())
    expect(screen.getByDisplayValue('schemas/game.schema.json')).toBeTruthy()

    act(() => emitRedo())
    expect(screen.queryByDisplayValue('schemas/game.schema.json')).toBeFalsy()
  })

  it('handles undo and redo keyboard shortcuts', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByDisplayValue('schemas/game.schema.json')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(screen.queryByDisplayValue('schemas/game.schema.json')).toBeFalsy()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByDisplayValue('schemas/game.schema.json')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(screen.queryByDisplayValue('schemas/game.schema.json')).toBeFalsy()
  })

  it('retains history across a successful save', async () => {
    const user = userEvent.setup()
    const { emitSaveResult, dirty } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(dirty.at(-1)).toBe(true))

    act(() => emitSaveResult({ ok: true, version: 'v2' }))
    await waitFor(() => expect(dirty.at(-1)).toBe(false))

    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    await user.click(undo)
    expect(screen.getByDisplayValue('schemas/game.schema.json')).toBeTruthy()
    await waitFor(() => expect(dirty.at(-1)).toBe(true))
  })

  it('clears history when the document reloads', async () => {
    const user = userEvent.setup()
    const { emitFileChanged } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    )

    act(() => emitFileChanged({ kind: 'changed', path: '/project.json' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    )
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds and removes import map entries', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.type(screen.getByPlaceholderText('namespace'), 'shared')
    await user.type(screen.getByPlaceholderText(/schemas\/name/), 'schemas/shared.schema.json')
    await user.click(screen.getByRole('button', { name: 'Add import' }))
    expect((await screen.findAllByText('shared')).length).toBeGreaterThan(0)
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    await user.click(removeButtons[0])
    expect(screen.queryByDisplayValue('schemas/game.schema.json')).toBeFalsy()
  })

  it('maps a discovered schema with one click', async () => {
    const user = userEvent.setup()
    renderEditor({ imports: {} })
    expect(await screen.findByText('Schemas found but not mapped')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Map' }))
    expect(await screen.findByDisplayValue('schemas/game.schema.json')).toBeTruthy()
  })

  it('opens a file from a project validation issue', async () => {
    const user = userEvent.setup()
    const { client } = renderEditor({ imports: {} })
    await user.click(await screen.findByRole('button', { name: /Open \/scenes\/train/ }))
    expect(client.openFile).toHaveBeenCalledWith('/scenes/train.scene.json')
  })

  it('returns project text through the save handler', () => {
    const { saveHandlers } = renderEditor()
    expect(saveHandlers).toHaveLength(1)
    const text = saveHandlers[0]().text
    expect(text).toContain('"game": "schemas/game.schema.json"')
  })

  it('disables import editing and history in a read-only workspace', () => {
    renderEditor(undefined, false)
    expect((screen.getByDisplayValue('schemas/game.schema.json') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add import' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
