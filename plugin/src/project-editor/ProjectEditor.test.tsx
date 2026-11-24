// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
  const dirty: boolean[] = []
  const client = {
    file: { path: '/project.json' },
    capabilities: { write: true },
    initialization: { permissions: ['workspace:write'] },
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
    openFile: vi.fn(async () => ({ ok: true })),
    readFile: async () => ({
      path: '/project.json',
      version: 'v1',
      text: JSON.stringify({ imports: { game: 'schemas/game.schema.json' } }),
    }),
  } as unknown as EditorClient
  return { client, saveHandlers, dirty }
}

function renderEditor(
  manifest: ProjectManifest = { imports: { game: 'schemas/game.schema.json' } },
  canWrite = true,
  ws = workspace(),
) {
  const { client, saveHandlers, dirty } = mockClient()
  const result = render(
    <ProjectEditor
      client={client}
      initialManifest={manifest}
      canWrite={canWrite}
      workspace={ws}
    />,
  )
  return { ...result, client, saveHandlers, dirty }
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

  it('edits a location and reports dirty', async () => {
    const user = userEvent.setup()
    const { dirty } = renderEditor()
    const input = screen.getByDisplayValue('schemas/game.schema.json')
    await user.clear(input)
    await user.type(input, 'schemas/missing.schema.json')
    expect(dirty).toContain(true)
    expect(await screen.findByText(/blocking error/)).toBeTruthy()
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

  it('disables import editing in a read-only workspace', () => {
    renderEditor(undefined, false)
    expect((screen.getByDisplayValue('schemas/game.schema.json') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Add import' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
