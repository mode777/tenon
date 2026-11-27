import type { SceneDocument } from '../core/scene'
import type { SceneCommand } from './scene-commands'

export const SCENE_PANEL_TOPIC = 'local/tenon.scene' as const
export const HIERARCHY_PANEL_ID = 'tenon.scene.hierarchy'
export const INSPECTOR_PANEL_ID = 'tenon.scene.inspector'
export const INSPECTION_PANEL_ID = 'tenon.scene.inspection'

export type InspectionTab = 'validation' | 'public' | 'debug'
export type SceneTransformMode = 'translate' | 'rotate' | 'scale'

export type SceneEditorIntent =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'set-mode'; mode: SceneTransformMode }
  | { type: 'refresh-workspace' }

export interface ScenePanelSnapshot {
  revision: number
  path: string
  doc: SceneDocument
  selection: string | null
  canWrite: boolean
  levelMode: boolean
}

export type ScenePanelMessage =
  | { kind: 'snapshot-request'; target: string; requestId: string }
  | { kind: 'snapshot'; snapshot: ScenePanelSnapshot }
  | { kind: 'command'; target: string; requestId: string; command: SceneCommand }
  | { kind: 'intent'; target: string; requestId: string; intent: SceneEditorIntent }
  | { kind: 'command-result'; requestId: string; ok: boolean; message?: string }
  | { kind: 'focus-tab'; path: string; tab: InspectionTab }
  | { kind: 'discover'; requestId: string }
  | { kind: 'editor-online'; path: string; instanceId: string; active: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSceneEditorIntent(value: unknown): value is SceneEditorIntent {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'undo':
    case 'redo':
    case 'save':
    case 'refresh-workspace':
      return true
    case 'set-mode':
      return value.mode === 'translate' || value.mode === 'rotate' || value.mode === 'scale'
    default:
      return false
  }
}

/** Minimal validation of plugin-local messages; the shell never interprets them. */
export function isScenePanelMessage(value: unknown): value is ScenePanelMessage {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  switch (value.kind) {
    case 'snapshot-request':
      return typeof value.target === 'string' && typeof value.requestId === 'string'
    case 'snapshot':
      return isRecord(value.snapshot) && typeof value.snapshot.revision === 'number'
    case 'command':
      return (
        typeof value.target === 'string' &&
        typeof value.requestId === 'string' &&
        isRecord(value.command) &&
        typeof value.command.type === 'string'
      )
    case 'intent':
      return (
        typeof value.target === 'string' &&
        typeof value.requestId === 'string' &&
        isSceneEditorIntent(value.intent)
      )
    case 'command-result':
      return (
        typeof value.requestId === 'string' &&
        typeof value.ok === 'boolean' &&
        (value.message === undefined || typeof value.message === 'string')
      )
    case 'focus-tab':
      return (
        typeof value.path === 'string' &&
        (value.tab === 'validation' || value.tab === 'public' || value.tab === 'debug')
      )
    case 'discover':
      return typeof value.requestId === 'string'
    case 'editor-online':
      return (
        typeof value.path === 'string' &&
        typeof value.instanceId === 'string' &&
        typeof value.active === 'boolean'
      )
    default:
      return false
  }
}
