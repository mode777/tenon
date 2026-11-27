import type { EditorClient } from '@exo/plugin-sdk'
import { useCallback, useEffect, useRef } from 'react'
import type { SceneDocument, SceneValidationContext } from '../core/scene'
import { normalizeScenePath } from '../core/scene'
import { applySceneCommand } from './scene-commands'
import {
  HIERARCHY_PANEL_ID,
  INSPECTION_PANEL_ID,
  INSPECTOR_PANEL_ID,
  SCENE_PANEL_TOPIC,
  isScenePanelMessage,
  type InspectionTab,
  type ScenePanelMessage,
  type SceneTransformMode,
} from './scene-panel-protocol'

export interface ScenePanelBridgeOptions {
  client: EditorClient
  doc: SceneDocument
  selection: string | null
  canWrite: boolean
  levelMode: boolean
  scenePath: string
  context: SceneValidationContext
  commit: (doc: SceneDocument) => void
  setSelection: (id: string | null) => void
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onSetMode: (mode: SceneTransformMode) => void
  onRefreshWorkspace: () => Promise<void> | void
  onError: (message: string) => void
}

export interface ScenePanelBridge {
  revealHierarchy: () => void
  revealInspector: () => void
  revealInspection: (tab?: InspectionTab) => void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Editor side of the shell-panel bridge. It publishes the current scene state on
 * a plugin-local topic, answers snapshot requests and applies panel commands
 * through the same reducer the panel uses. The editor stays the only writer.
 */
export function useScenePanelBridge(options: ScenePanelBridgeOptions): ScenePanelBridge {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const stateRef = useRef({
    doc: options.doc,
    selection: options.selection,
    canWrite: options.canWrite,
    levelMode: options.levelMode,
    scenePath: normalizeScenePath(options.scenePath),
    context: options.context,
  })
  stateRef.current = {
    doc: options.doc,
    selection: options.selection,
    canWrite: options.canWrite,
    levelMode: options.levelMode,
    scenePath: normalizeScenePath(options.scenePath),
    context: options.context,
  }

  const instanceId = options.client.instanceId
  const revisionRef = useRef(0)
  const reportedErrorRef = useRef<string | null>(null)
  const revealedRef = useRef(false)
  const activeRef = useRef(true)

  const reportError = useCallback((message: string) => {
    if (reportedErrorRef.current === message) return
    reportedErrorRef.current = message
    optionsRef.current.onError(message)
  }, [])

  const publishSnapshot = useCallback(
    (doc: SceneDocument, selection: string | null) => {
      if (!instanceId) return
      const state = stateRef.current
      revisionRef.current += 1
      const message: ScenePanelMessage = {
        kind: 'snapshot',
        snapshot: {
          revision: revisionRef.current,
          path: state.scenePath,
          doc,
          selection,
          canWrite: state.canWrite,
          levelMode: state.levelMode,
        },
      }
      void optionsRef.current.client
        .publishLocal(SCENE_PANEL_TOPIC, message)
        .catch((error: unknown) => reportError(`Could not sync the scene panels: ${errorMessage(error)}`))
    },
    [instanceId, reportError],
  )

  const publishCurrentSnapshot = useCallback(() => {
    const state = stateRef.current
    publishSnapshot(state.doc, state.selection)
  }, [publishSnapshot])

  const publishResult = useCallback(
    (requestId: string, ok: boolean, message?: string) => {
      if (!instanceId) return
      void optionsRef.current.client
        .publishLocal(SCENE_PANEL_TOPIC, {
          kind: 'command-result',
          requestId,
          ok,
          ...(message === undefined ? {} : { message }),
        })
        .catch(() => undefined)
    },
    [instanceId],
  )

  const publishOnline = useCallback(
    (active: boolean) => {
      if (!instanceId) return
      void optionsRef.current.client
        .publishLocal(SCENE_PANEL_TOPIC, {
          kind: 'editor-online',
          path: stateRef.current.scenePath,
          instanceId,
          active,
        })
        .catch(() => undefined)
    },
    [instanceId],
  )

  useEffect(() => {
    if (!instanceId) return
    const client = optionsRef.current.client
    const off = client.onLocalEvent(SCENE_PANEL_TOPIC, (event) => {
      if (!isScenePanelMessage(event.payload)) return
      const message = event.payload
      if (message.kind === 'snapshot-request' && message.target === instanceId) {
        publishCurrentSnapshot()
        return
      }
      if (message.kind === 'discover') {
        if (activeRef.current) publishOnline(true)
        return
      }
      if (message.kind === 'intent' && message.target === instanceId) {
        void (async () => {
          try {
            const options = optionsRef.current
            switch (message.intent.type) {
              case 'undo':
                options.onUndo()
                break
              case 'redo':
                options.onRedo()
                break
              case 'save':
                options.onSave()
                break
              case 'set-mode':
                options.onSetMode(message.intent.mode)
                break
              case 'refresh-workspace':
                await options.onRefreshWorkspace()
                break
            }
            publishResult(message.requestId, true)
          } catch (error) {
            publishResult(message.requestId, false, errorMessage(error))
          }
        })()
        return
      }
      if (message.kind !== 'command' || message.target !== instanceId) return
      try {
        const state = stateRef.current
        const result = applySceneCommand(state.doc, message.command, state.context)
        if (result.doc !== state.doc) {
          stateRef.current = { ...state, doc: result.doc }
          optionsRef.current.commit(result.doc)
        }
        if (result.selection !== undefined) {
          stateRef.current = { ...stateRef.current, selection: result.selection }
          optionsRef.current.setSelection(result.selection)
        }
        publishSnapshot(stateRef.current.doc, stateRef.current.selection)
        publishResult(message.requestId, true)
      } catch (error) {
        publishResult(message.requestId, false, errorMessage(error))
      }
    })
    void client
      .subscribeLocal(SCENE_PANEL_TOPIC)
      .then(() => publishOnline(activeRef.current))
      .catch((error: unknown) =>
        reportError(`Could not subscribe the scene panels: ${errorMessage(error)}`),
      )
    return () => {
      off()
      client.unsubscribe(SCENE_PANEL_TOPIC)
    }
  }, [
    instanceId,
    publishCurrentSnapshot,
    publishOnline,
    publishResult,
    publishSnapshot,
    reportError,
  ])

  useEffect(() => {
    if (!instanceId) return
    const timer = window.setTimeout(() => publishCurrentSnapshot(), 25)
    return () => window.clearTimeout(timer)
  }, [
    instanceId,
    publishCurrentSnapshot,
    options.doc,
    options.selection,
    options.canWrite,
    options.levelMode,
    options.scenePath,
  ])

  const revealHierarchy = useCallback(() => {
    const client = optionsRef.current.client
    if (!client.capabilities.requestPanel) return
    revealedRef.current = true
    void client.requestPanel(HIERARCHY_PANEL_ID, 'show').catch(() => undefined)
  }, [])

  const revealInspector = useCallback(() => {
    const client = optionsRef.current.client
    if (!client.capabilities.requestPanel) return
    revealedRef.current = true
    void client.requestPanel(INSPECTOR_PANEL_ID, 'show').catch(() => undefined)
  }, [])

  const revealInspection = useCallback((tab: InspectionTab = 'validation') => {
    const client = optionsRef.current.client
    if (!client.capabilities.requestPanel) return
    revealedRef.current = true
    void client
      .requestPanel(INSPECTION_PANEL_ID, 'show')
      .then(() => {
        void client
          .publishLocal(SCENE_PANEL_TOPIC, {
            kind: 'focus-tab',
            path: stateRef.current.scenePath,
            tab,
          })
          .catch(() => undefined)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!instanceId) return
    const client = optionsRef.current.client
    if (!client.capabilities.requestPanel) return
    let cancelled = false
    const reveal = async () => {
      const results = await Promise.allSettled([
        client.requestPanel(HIERARCHY_PANEL_ID, 'show'),
        client.requestPanel(INSPECTOR_PANEL_ID, 'show'),
        client.requestPanel(INSPECTION_PANEL_ID, 'show'),
      ])
      if (!cancelled && results.some((result) => result.status === 'fulfilled')) {
        revealedRef.current = true
      }
    }
    void reveal()
    const off = client.onEvent('editor/active', (event) => {
      const own = event.payload.active && event.payload.instanceId === instanceId
      if (!event.payload.active || !own) {
        activeRef.current = false
        publishOnline(false)
        return
      }
      activeRef.current = true
      publishOnline(true)
      if (!revealedRef.current) void reveal()
    })
    void client.subscribe('editor/active').catch(() => undefined)
    return () => {
      cancelled = true
      off()
      client.unsubscribe('editor/active')
    }
  }, [instanceId, publishOnline])

  return { revealHierarchy, revealInspector, revealInspection }
}
