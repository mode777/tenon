// @vitest-environment jsdom
import type { EditorClient, ViewClient } from '@exo/plugin-sdk'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { entityById } from '../../core/scene'
import { SCENE_PANEL_TOPIC, type ScenePanelMessage } from '../scene-panel-protocol'
import { useScenePanel } from './useScenePanel'
import { useScenePanelBridge } from '../useScenePanelBridge'
import { contextFor, levelScene } from './panel-test-fixtures'

afterEach(cleanup)

type LocalHandler = (event: {
  topic: string
  seq: number
  from: string
  payload: unknown
}) => void

function fakeEditorClient() {
  let localHandler: LocalHandler | null = null
  const publishLocal = vi.fn(async (topic: string, payload: unknown) => ({ topic, seq: 1 }))
  const requestPanel = vi.fn(async (panel: string) => ({ panel, open: true }))
  const client = {
    instanceId: 'editor-1',
    capabilities: { requestPanel: true },
    publishLocal,
    subscribeLocal: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    subscribe: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    unsubscribe: vi.fn(),
    requestPanel,
    onLocalEvent: (_topic: string, handler: LocalHandler) => {
      localHandler = handler
      return () => undefined
    },
    onEvent: () => () => undefined,
  } as unknown as EditorClient
  return {
    client,
    publishLocal,
    requestPanel,
    emitLocal: (payload: ScenePanelMessage) =>
      localHandler?.({
        topic: SCENE_PANEL_TOPIC,
        seq: 1,
        from: 'editor-1',
        payload,
      }),
  }
}

function BridgeHarness({
  client,
  commit,
  setSelection,
  onError,
}: {
  client: EditorClient
  commit: (doc: ReturnType<typeof levelScene>) => void
  setSelection: (id: string | null) => void
  onError: (message: string) => void
}) {
  const doc = levelScene()
  useScenePanelBridge({
    client,
    doc,
    selection: 'train_1',
    canWrite: true,
    levelMode: true,
    scenePath: '/levels/level01.scene.json',
    context: contextFor(doc),
    commit,
    setSelection,
    onError,
  })
  return null
}

function fakeViewClient(
  activeEditor: ViewClient['activeEditor'] = {
    pluginId: 'com.tenon.editor',
    path: '/levels/level01.scene.json',
    instanceId: 'editor-1',
  },
) {
  let localHandler: LocalHandler | null = null
  let activeHandler:
    | ((event: { payload: { pluginId: string; active: boolean; path?: string; instanceId?: string } }) => void)
    | null = null
  const publishLocal = vi.fn(async (topic: string, payload: unknown) => ({ topic, seq: 1 }))
  const view = {
    activeEditor,
    initialization: { plugin: { id: 'com.tenon.editor' } },
    capabilities: { localEvents: true, editorContext: true },
    publishLocal,
    subscribeLocal: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    subscribe: vi.fn(async (topic: string) => ({ topic, seq: 1 })),
    unsubscribe: vi.fn(),
    onLocalEvent: (_topic: string, handler: LocalHandler) => {
      localHandler = handler
      return () => undefined
    },
    onEvent: (
      _topic: string,
      handler: (event: {
        payload: { pluginId: string; active: boolean; path?: string; instanceId?: string }
      }) => void,
    ) => {
      activeHandler = handler
      return () => undefined
    },
  } as unknown as ViewClient
  return {
    view,
    publishLocal,
    emitLocal: (payload: ScenePanelMessage, from = 'editor-1') =>
      localHandler?.({
        topic: SCENE_PANEL_TOPIC,
        seq: 1,
        from,
        payload,
      }),
    emitActive: (payload: {
      pluginId: string
      active: boolean
      path?: string
      instanceId?: string
    }) => activeHandler?.({ payload }),
  }
}

function PanelHarness({ view }: { view: ViewClient }) {
  const panel = useScenePanel(view)
  return (
    <div>
      <span data-testid="path">{panel.activeEditor?.path ?? 'none'}</span>
      <span data-testid="doc">{panel.snapshot?.doc.id ?? 'none'}</span>
      <span data-testid="error">{panel.error ?? ''}</span>
      <button type="button" onClick={() => panel.sendCommand({ type: 'select', entityId: 'root' })}>
        Select root
      </button>
    </div>
  )
}

describe('scene panel bridge', () => {
  it('publishes snapshots, answers requests, and applies commands', async () => {
    const { client, publishLocal, emitLocal } = fakeEditorClient()
    const commit = vi.fn<(doc: ReturnType<typeof levelScene>) => void>()
    const setSelection = vi.fn<(id: string | null) => void>()
    const onError = vi.fn<(message: string) => void>()
    render(
      <BridgeHarness
        client={client}
        commit={commit}
        setSelection={setSelection}
        onError={onError}
      />,
    )

    await waitFor(() =>
      expect(
        publishLocal.mock.calls.some((call) => (call[1] as ScenePanelMessage).kind === 'snapshot'),
      ).toBe(true),
    )

    publishLocal.mockClear()
    emitLocal({ kind: 'snapshot-request', target: 'editor-1', requestId: 'r1' })
    expect(
      publishLocal.mock.calls.some((call) => (call[1] as ScenePanelMessage).kind === 'snapshot'),
    ).toBe(true)

    publishLocal.mockClear()
    emitLocal({ kind: 'discover', requestId: 'd1' })
    expect(
      publishLocal.mock.calls.some(
        (call) =>
          (call[1] as ScenePanelMessage).kind === 'editor-online' &&
          (call[1] as { active?: boolean }).active === true,
      ),
    ).toBe(true)

    publishLocal.mockClear()
    emitLocal({
      kind: 'command',
      target: 'editor-1',
      requestId: 'c1',
      command: { type: 'set-entity-name', entityId: 'train_1', value: 'Train' },
    })
    expect(commit).toHaveBeenCalled()
    expect(entityById(commit.mock.calls[0][0], 'train_1')?.name).toBe('Train')
    expect(
      publishLocal.mock.calls.some(
        (call) => (call[1] as ScenePanelMessage).kind === 'command-result',
      ),
    ).toBe(true)

    publishLocal.mockClear()
    emitLocal({
      kind: 'command',
      target: 'editor-1',
      requestId: 'c2',
      command: { type: 'delete-entity', entityId: 'root' },
    })
    const result = publishLocal.mock.calls
      .map((call) => call[1] as ScenePanelMessage)
      .find((message) => message.kind === 'command-result')
    expect(result).toMatchObject({ kind: 'command-result', ok: false })
  })

  it('follows the active scene editor and sends commands to that instance', async () => {
    const user = userEvent.setup()
    const { view, publishLocal, emitLocal, emitActive } = fakeViewClient()
    render(<PanelHarness view={view} />)

    await waitFor(() =>
      expect(
        publishLocal.mock.calls.some(
          (call) =>
            (call[1] as ScenePanelMessage).kind === 'snapshot-request' &&
            (call[1] as { target?: string }).target === 'editor-1',
        ),
      ).toBe(true),
    )

    emitLocal({
      kind: 'snapshot',
      snapshot: {
        revision: 1,
        path: '/levels/level01.scene.json',
        doc: levelScene(),
        selection: null,
        canWrite: true,
        levelMode: true,
      },
    })
    expect(await screen.findByText('scene_level')).toBeTruthy()

    emitLocal({
      kind: 'command-result',
      requestId: 'x',
      ok: false,
      message: 'Nope',
    })
    expect(await screen.findByText('Nope')).toBeTruthy()

    emitActive({
      pluginId: 'com.tenon.editor',
      active: true,
      path: '/scenes/train.scene.json',
      instanceId: 'editor-2',
    })
    expect(await screen.findByText('/scenes/train.scene.json')).toBeTruthy()
    await waitFor(() =>
      expect(
        publishLocal.mock.calls.some(
          (call) =>
            (call[1] as ScenePanelMessage).kind === 'snapshot-request' &&
            (call[1] as { target?: string }).target === 'editor-2',
        ),
      ).toBe(true),
    )

    await user.click(screen.getByRole('button', { name: 'Select root' }))
    const command = publishLocal.mock.calls
      .map((call) => call[1] as ScenePanelMessage)
      .find((message) => message.kind === 'command')
    expect(command).toMatchObject({ kind: 'command', target: 'editor-2' })
  })

  it('discovers the active scene editor when the panel starts before it', async () => {
    const { view, publishLocal, emitLocal } = fakeViewClient(null)
    render(<PanelHarness view={view} />)

    await waitFor(() =>
      expect(
        publishLocal.mock.calls.some(
          (call) => (call[1] as ScenePanelMessage).kind === 'discover',
        ),
      ).toBe(true),
    )

    emitLocal(
      {
        kind: 'editor-online',
        path: '/levels/level01.scene.json',
        instanceId: 'editor-9',
        active: true,
      },
      'editor-9',
    )
    await waitFor(() =>
      expect(
        publishLocal.mock.calls.some(
          (call) =>
            (call[1] as ScenePanelMessage).kind === 'snapshot-request' &&
            (call[1] as { target?: string }).target === 'editor-9',
        ),
      ).toBe(true),
    )

    emitLocal(
      {
        kind: 'snapshot',
        snapshot: {
          revision: 1,
          path: '/levels/level01.scene.json',
          doc: levelScene(),
          selection: null,
          canWrite: true,
          levelMode: true,
        },
      },
      'editor-9',
    )
    expect(await screen.findByText('scene_level')).toBeTruthy()
  })
})
