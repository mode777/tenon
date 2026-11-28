// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorClient } from '@exo/plugin-sdk'
import { SchemaEditor } from './SchemaEditor'
import type { SchemaBundle } from '../core/schema'

function shared(): SchemaBundle {
  return {
    id: 'com.example.shared',
    version: '1.0.0',
    namespace: 'shared',
    enums: {
      Kind: { values: ['primary', 'secondary'] },
    },
    definitions: {
      'shared:base': {
        abstract: true,
        fields: {
          weight: { type: 'float', default: 1 },
          kind: { type: 'enum', enum: 'Kind', default: 'primary' },
        },
      },
    },
  }
}

function sample(): SchemaBundle {
  return {
    id: 'com.example.gameA',
    version: '1.0.0',
    namespace: 'gameA',
    enums: {
      ButtonStyle: { values: ['primary', 'secondary'] },
    },
    definitions: {
      'gameA:renderable': {
        abstract: true,
        fields: {
          visible: { type: 'bool', default: true },
          castShadows: { type: 'bool', default: true },
        },
      },
      'gameA:button': {
        compose: ['gameA:renderable'],
        fields: {
          label: { type: 'string', default: 'Press' },
          style: { type: 'enum', enum: 'ButtonStyle', default: 'primary' },
        },
        events: {
          pressed: {},
        },
      },
      'gameA:elevatorButton': {
        compose: ['gameA:button'],
        fields: {
          label: { type: 'string', default: 'Call Elevator' },
        },
      },
    },
  }
}

function mockClient() {
  const saveHandlers: Array<() => { text: string }> = []
  const dirty: boolean[] = []
  const undoListeners = new Set<() => void>()
  const redoListeners = new Set<() => void>()
  let commandHandler: ((invocation: { command: string }) => unknown) | null = null
  const requestNewFile = vi.fn(async () => ({ path: '/schemas/new.schema.json', version: 'v1' }))
  const openFile = vi.fn(async () => ({ ok: true }))
  const client = {
    file: { path: '/schemas/gameA.schema.json' },
    capabilities: { write: true, createFile: true },
    initialization: { permissions: ['workspace:write'] },
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
    onCommand: (handler: (invocation: { command: string }) => unknown) => {
      commandHandler = handler
      return () => undefined
    },
    requestNewFile,
    openFile,
    requestSave: () => undefined,
    readFile: async () => ({ path: '/schemas/gameA.schema.json', version: 'v1', text: '' }),
  } as unknown as EditorClient
  return {
    client,
    saveHandlers,
    dirty,
    requestNewFile,
    openFile,
    getCommandHandler: () => commandHandler,
    emitUndo: () => {
      for (const listener of [...undoListeners]) listener()
    },
    emitRedo: () => {
      for (const listener of [...redoListeners]) listener()
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SchemaEditor', () => {
  it('renders definitions, effective fields, and validation', () => {
    const { client } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)
    expect(screen.getAllByText('gameA:button').length).toBeGreaterThan(0)
    expect(screen.getByText('Fields')).toBeTruthy()
    expect(screen.getByText('Effective')).toBeTruthy()
    expect(screen.getAllByText(/errors/).length).toBeGreaterThan(0)
  })

  it('adds a field through the inline form', async () => {
    const user = userEvent.setup()
    const { client } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)
    await user.click(screen.getByRole('button', { name: /Field/ }))
    const input = screen.getByPlaceholderText('field name')
    await user.type(input, 'count')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findAllByText('count')).length).toBeGreaterThan(0)
  })

  it('creates a new definition from the sidebar', async () => {
    const user = userEvent.setup()
    const { client } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)
    await user.click(screen.getByRole('button', { name: /New definition/ }))
    const input = screen.getByPlaceholderText('local name')
    await user.type(input, 'trigger')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findAllByText('trigger')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('gameA:trigger').length).toBeGreaterThan(0)
  })

  it('reports dirty and returns serialized text on save', async () => {
    const user = userEvent.setup()
    const { client, saveHandlers, dirty } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)
    await user.click(screen.getByRole('button', { name: /New definition/ }))
    const input = screen.getByPlaceholderText('local name')
    await user.type(input, 'trigger')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(dirty.at(-1)).toBe(true))
    expect(saveHandlers.length).toBeGreaterThan(0)
    const saved = saveHandlers[0]()
    expect(JSON.parse(saved.text).definitions['gameA:trigger']).toBeTruthy()
  })

  it('switches to the effective view and shows origin badges', async () => {
    const user = userEvent.setup()
    const { client } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)
    await user.click(screen.getByRole('tab', { name: /Effective/ }))
    expect(screen.getByText('This is the flat definition the runtime and inspector will see.')).toBeTruthy()
    expect(screen.getAllByText('gameA:renderable').length).toBeGreaterThan(0)
  })

  it('renders the validation drawer and jumps to an issue', async () => {
    const user = userEvent.setup()
    const bundle = sample()
    bundle.definitions['gameA:button'].compose = ['gameA:missing']
    const { client } = mockClient()
    render(<SchemaEditor client={client} initialDoc={bundle} canWrite />)
    await user.click(screen.getAllByRole('button', { name: /errors/ })[0])
    expect(screen.getByRole('region', { name: 'Validation' })).toBeTruthy()
    expect(screen.getByText(/does not exist/)).toBeTruthy()
  })

  it('shows imported packages and their definitions read-only', async () => {
    const user = userEvent.setup()
    const bundle = sample()
    bundle.imports = { shared: '1.0.0' }
    bundle.definitions['gameA:button'].compose = ['gameA:renderable', 'shared:base']
    const { client } = mockClient()
    render(
      <SchemaEditor
        client={client}
        initialDoc={bundle}
        canWrite
        packages={[{ path: '/schemas/shared.schema.json', bundle: shared() }]}
        projectImports={{ shared: 'schemas/shared.schema.json' }}
      />,
    )
    expect(screen.getByText(/shared@1.0.0/)).toBeTruthy()
    await user.click(screen.getByTitle('shared:base'))
    expect(screen.getByText(/Imported definition, read-only/)).toBeTruthy()
    expect(screen.getAllByText('weight').length).toBeGreaterThan(0)
  })

  it('adds a schema import from the package picker and saves it', async () => {
    const user = userEvent.setup()
    const bundle = sample()
    const { client, saveHandlers } = mockClient()
    render(
      <SchemaEditor
        client={client}
        initialDoc={bundle}
        canWrite
        packages={[{ path: '/schemas/shared.schema.json', bundle: shared() }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Import schema/ }))
    await user.click(screen.getByRole('button', { name: /shared@1.0.0/ }))
    await waitFor(() => expect(saveHandlers.length).toBeGreaterThan(0))
    const saved = JSON.parse(saveHandlers[0]().text)
    expect(saved.imports).toEqual({ shared: '1.0.0' })
    expect(screen.getAllByText(/shared@1.0.0/).length).toBeGreaterThan(0)
  })

  it('restores definition selection after undoing a delete', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { client } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)

    await user.click(screen.getByTitle('gameA:elevatorButton'))
    expect(screen.getByText('gameA:elevatorButton', { selector: '.qualified-id' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByTitle('gameA:elevatorButton')).toBeFalsy()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByText('gameA:elevatorButton', { selector: '.qualified-id' })).toBeTruthy()
  })

  it('commits schema identity on blur and undoes it in one step', async () => {
    const user = userEvent.setup()
    const { client, dirty } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)

    const id = screen.getByLabelText('Schema bundle ID')
    await user.clear(id)
    await user.type(id, 'com.example.other')
    expect(dirty.at(-1)).toBe(false)

    await user.tab()
    await waitFor(() => expect(dirty.at(-1)).toBe(true))
    expect(screen.getByDisplayValue('com.example.other')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByDisplayValue('com.example.gameA')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeTruthy()
    await waitFor(() => expect(dirty.at(-1)).toBe(false))
  })

  it('applies shell undo and redo intents', async () => {
    const user = userEvent.setup()
    const { client, emitUndo, emitRedo } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)

    const id = screen.getByLabelText('Schema bundle ID')
    await user.clear(id)
    await user.type(id, 'com.example.other')
    await user.tab()
    expect(screen.getByDisplayValue('com.example.other')).toBeTruthy()

    act(() => emitUndo())
    expect(screen.getByDisplayValue('com.example.gameA')).toBeTruthy()

    act(() => emitRedo())
    expect(screen.getByDisplayValue('com.example.other')).toBeTruthy()
  })

  it('handles redo with Ctrl+Y', async () => {
    const user = userEvent.setup()
    const { client } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)

    const id = screen.getByLabelText('Schema bundle ID')
    await user.clear(id)
    await user.type(id, 'com.example.other')
    await user.tab()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByDisplayValue('com.example.gameA')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(screen.getByDisplayValue('com.example.other')).toBeTruthy()
  })

  it('disables undo and redo in a read-only workspace', () => {
    const { client } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite={false} />)
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renames the namespace and rewrites definition IDs', async () => {
    const user = userEvent.setup()
    const { client, saveHandlers } = mockClient()
    render(<SchemaEditor client={client} initialDoc={sample()} canWrite />)
    const namespace = screen.getByLabelText('Schema namespace')
    await user.clear(namespace)
    await user.type(namespace, 'studio{Enter}')
    await waitFor(() => expect(saveHandlers.length).toBeGreaterThan(0))
    const saved = JSON.parse(saveHandlers[0]().text)
    expect(saved.namespace).toBe('studio')
    expect(saved.definitions['studio:button']).toBeTruthy()
    expect(saved.definitions['gameA:button']).toBeUndefined()
    expect(saved.definitions['studio:button'].compose).toEqual(['studio:renderable'])
  })
})
