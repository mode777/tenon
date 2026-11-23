// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ViewClient } from '@exo/plugin-sdk'
import { ProjectHub } from './main'

function mockClient(overrides: Record<string, unknown> = {}) {
  const client = {
    initialization: {
      permissions: ['workspace:read', 'workspace:write', 'workspace:list'],
      shell: { version: '0.7.0' },
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
    onDispose: () => () => undefined,
    ...overrides,
  } as unknown as ViewClient
  return { client }
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
    await user.click(screen.getByRole('button', { name: 'New Schema' }))
    await waitFor(() => expect(client.requestNewFile).toHaveBeenCalledTimes(1))
    expect(client.requestNewFile).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'new.schema.json',
      directory: '/schemas',
      text: expect.stringContaining('"definitions"'),
    }))
    await waitFor(() => expect(client.openFile).toHaveBeenCalledWith('/schemas/new.schema.json'))
  })

  it('shows an empty state when there are no schemas', async () => {
    const { client } = mockClient({
      listDirectory: vi.fn(async () => ({ entries: [] })),
    })
    render(<ProjectHub client={client} />)
    expect(await screen.findByText('No schema bundles yet')).toBeTruthy()
  })

  it('disables New Schema in a read-only workspace', async () => {
    const { client } = mockClient({
      initialization: { permissions: ['workspace:read'], shell: { version: '0.7.0' } },
      capabilities: { write: false, createFile: true, directoryListing: true, filePicker: true },
    })
    render(<ProjectHub client={client} />)
    expect(await screen.findByText(/read-only/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'New Schema' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
