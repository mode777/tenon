// @vitest-environment jsdom
import type { ViewClient } from '@exo/plugin-sdk'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCENE_PANEL_TOPIC, type ScenePanelMessage } from '../scene-panel-protocol'
import { HierarchyPanelRoot } from './panel-roots'
import { levelScene, workspace } from './panel-test-fixtures'

afterEach(cleanup)

type LocalHandler = (event: {
  topic: string
  seq: number
  from: string
  payload: unknown
}) => void

function fakeView(activeEditor: ViewClient['activeEditor'] = {
  pluginId: 'com.tenon.editor',
  path: '/levels/level01.scene.json',
  instanceId: 'editor-1',
}) {
  let localHandler: LocalHandler | null = null
  const publishLocal = vi.fn(async (topic: string, payload: unknown) => ({ topic, seq: 1 }))
  const readFile = vi.fn(async (path: string) => {
    if (path === '/project.json') return { path, version: 'v1', text: '{}' }
    throw new Error(`unexpected read ${path}`)
  })
  const listDirectory = vi.fn(async (path: string) => {
    if (path === '/assets') {
      return { entries: [{ path: '/assets/cube.glb', kind: 'file' }] }
    }
    if (path === '/schemas') {
      return { entries: [] }
    }
    if (path === '/scenes' || path === '/levels') {
      return { entries: [] }
    }
    return { entries: [] }
  })
  const view = {
    activeEditor,
    initialization: {
      plugin: { id: 'com.tenon.editor' },
      permissions: ['workspace:read', 'workspace:list'],
    },
    capabilities: {
      localEvents: true,
      editorContext: true,
      directoryListing: true,
    },
    publishLocal,
    readFile,
    listDirectory,
    subscribeLocal: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    subscribe: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    unsubscribe: vi.fn(),
    onLocalEvent: (_topic: string, handler: LocalHandler) => {
      localHandler = handler
      return () => undefined
    },
    onEvent: () => () => undefined,
  } as unknown as ViewClient
  return {
    view,
    publishLocal,
    readFile,
    emitLocal: (payload: ScenePanelMessage, from = 'editor-1') =>
      localHandler?.({
        topic: SCENE_PANEL_TOPIC,
        seq: 1,
        from,
        payload,
      }),
  }
}

describe('HierarchyPanelRoot', () => {
  it('shows an empty state when no scene is active', () => {
    const { view } = fakeView(null)
    render(<HierarchyPanelRoot view={view} workspace={workspace()} />)
    expect(screen.getByText('No scene selected')).toBeTruthy()
  })

  it('refreshes both the panel workspace and the editor context', async () => {
    const user = userEvent.setup()
    const { view, publishLocal, readFile, emitLocal } = fakeView()
    render(<HierarchyPanelRoot view={view} workspace={workspace()} />)

    await waitFor(() =>
      expect(
        publishLocal.mock.calls.some(
          (call) => (call[1] as ScenePanelMessage).kind === 'snapshot-request',
        ),
      ).toBe(true),
    )
    emitLocal({
      kind: 'snapshot',
      snapshot: {
        revision: 1,
        path: '/levels/level01.scene.json',
        doc: levelScene(),
        selection: 'train_1',
        canWrite: true,
        levelMode: true,
      },
    })
    expect(await screen.findByRole('tree')).toBeTruthy()

    readFile.mockClear()
    publishLocal.mockClear()
    await user.click(screen.getByRole('button', { name: 'Refresh schemas and entities' }))

    expect(readFile).toHaveBeenCalledWith('/project.json', 'utf8')
    await waitFor(() =>
      expect(
        publishLocal.mock.calls.some(
          (call) =>
            (call[1] as ScenePanelMessage).kind === 'intent' &&
            (call[1] as { intent?: { type?: string } }).intent?.type === 'refresh-workspace',
        ),
      ).toBe(true),
    )
  })
})
