// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ViewClient } from '@exo/plugin-sdk'
import { ExoProtocolError } from '@exo/plugin-sdk'
import { ProjectHub } from './main'

function mockClient(overrides: Record<string, unknown> = {}) {
  let commandHandler: ((invocation: { command: string }) => unknown) | null = null
  const client = {
    initialization: {
      permissions: ['workspace:read', 'workspace:write', 'workspace:list'],
      shell: { version: '0.8.0' },
    },
    capabilities: {
      write: true,
      createFile: true,
      directoryListing: true,
      filePicker: true,
    },
    listDirectory: vi.fn(async () => ({
      entries: [
        { path: '/schemas/gameA.schema.json', kind: 'file', size: 100 },
        { path: '/schemas/other.schema.json', kind: 'file', size: 100 },
      ],
    })),
    requestNewFile: vi.fn(async () => ({ path: '/schemas/new.schema.json', version: 'v1' })),
    openFile: vi.fn(async () => ({ ok: true })),
    requestFiles: vi.fn(async () => []),
    onCommand: (handler: (invocation: { command: string }) => unknown) => {
      commandHandler = handler
      return () => undefined
    },
    onDispose: () => () => undefined,
    ...overrides,
  } as unknown as ViewClient
  return { client, getCommandHandler: () => commandHandler }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProjectHub', () => {
  it('lists schema bundles', async () => {
    const { client } = mockClient()
    render(<ProjectHub client={client} />)
    expect(await screen.findByText('gameA.schema.json')).toBeTruthy()
    expect(screen.getByText('other.schema.json')).toBeTruthy()
  })

  it('creates a schema and opens it', async () => {
    const user = userEvent.setup()
    const { client } = mockClient()
    render(<ProjectHub client={client} />)
    await user.click(await screen.findByRole('button', { name: 'New Schema' }))
    await waitFor(() => expect(client.requestNewFile).toHaveBeenCalledTimes(1))
    expect(client.requestNewFile).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'new.schema.json',
      directory: '/schemas',
      text: expect.stringContaining('"definitions"'),
    }))
    await waitFor(() => expect(client.openFile).toHaveBeenCalledWith('/schemas/new.schema.json'))
  })

  it('creates a scene and opens it', async () => {
    const user = userEvent.setup()
    const { client } = mockClient({
      requestNewFile: vi.fn(async () => ({ path: '/scenes/new.scene.json', version: 'v1' })),
    })
    render(<ProjectHub client={client} />)
    await user.click(await screen.findByRole('button', { name: 'New Scene' }))
    await waitFor(() => expect(client.requestNewFile).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'new.scene.json',
      directory: '/scenes',
      text: expect.stringContaining('"requires"'),
    })))
    await waitFor(() => expect(client.openFile).toHaveBeenCalledWith('/scenes/new.scene.json'))
  })

  it('handles the New Schema command without focus', async () => {
    const { client, getCommandHandler } = mockClient()
    render(<ProjectHub client={client} />)
    await waitFor(() => expect(getCommandHandler()).toBeTruthy())
    const result = await getCommandHandler()!({ command: 'tenon.new-schema' })
    expect(result).toEqual({ ok: true })
    expect(client.requestNewFile).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(client.openFile).toHaveBeenCalledWith('/schemas/new.schema.json'))
  })

  it('keeps schemas visible when the scenes directory is absent', async () => {
    const { client } = mockClient({
      listDirectory: vi.fn(async (path: string) => {
        if (path === '/scenes' || path === '/levels') {
          throw new ExoProtocolError('not-found', `Missing ${path}`)
        }
        return {
          entries: [{ path: '/schemas/gameA.schema.json', kind: 'file', size: 100 }],
        }
      }),
    })
    render(<ProjectHub client={client} />)
    expect(await screen.findByText('gameA.schema.json')).toBeTruthy()
    expect(await screen.findByText('No scenes yet')).toBeTruthy()
  })

  it('shows an empty state when there are no documents', async () => {
    const { client } = mockClient({
      listDirectory: vi.fn(async () => ({ entries: [] })),
    })
    render(<ProjectHub client={client} />)
    expect(await screen.findByText('No schemas or scenes yet')).toBeTruthy()
  })

  it('disables New Schema in a read-only workspace', async () => {
    const { client } = mockClient({
      initialization: { permissions: ['workspace:read'], shell: { version: '0.8.0' } },
      capabilities: { write: false, createFile: true, directoryListing: true, filePicker: true },
    })
    render(<ProjectHub client={client} />)
    expect(await screen.findByText(/read-only/i)).toBeTruthy()
    expect(((await screen.findByRole('button', { name: 'New Schema' })) as HTMLButtonElement).disabled).toBe(true)
  })
})
