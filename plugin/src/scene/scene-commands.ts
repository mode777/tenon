import { cloneJson } from '../core/schema'
import {
  addPromotion,
  addSlot,
  deleteEntity,
  duplicateEntity,
  entityById,
  entityIsSceneInstance,
  removeEntityProp,
  removePromotion,
  removeSlot,
  setEntityName,
  setEntityParent,
  setEntityProp,
  setEntityTransform,
  setEntityType,
  setSceneInstancePath,
  slotNamesForInstance,
  type EntityTransform,
  type SceneDocument,
  type SceneValidationContext,
} from '../core/scene'
import { withTypeRequirement } from './scene-workspace'

export type SceneCommand =
  | { type: 'select'; entityId: string | null }
  | { type: 'set-scene-id'; id: string }
  | { type: 'set-requirement'; index: number; value: string }
  | { type: 'add-requirement' }
  | { type: 'remove-requirement'; index: number }
  | { type: 'set-entity-name'; entityId: string; value: string }
  | { type: 'set-entity-type'; entityId: string; value: string }
  | { type: 'set-entity-scene'; entityId: string; value: string }
  | { type: 'set-entity-parent'; entityId: string; parentId: string }
  | { type: 'set-entity-slot'; entityId: string; slot: string }
  | { type: 'set-transform'; entityId: string; transform: EntityTransform }
  | { type: 'set-prop'; entityId: string; name: string; value: unknown }
  | { type: 'reset-prop'; entityId: string; name: string }
  | { type: 'delete-entity'; entityId: string }
  | { type: 'duplicate-entity'; entityId: string }
  | {
      type: 'add-promotion'
      name: string
      target: { entity: string; field?: string; event?: string }
    }
  | { type: 'remove-promotion'; name: string }
  | { type: 'add-slot'; name: string; entity: string }
  | { type: 'remove-slot'; name: string }

export interface SceneCommandResult {
  doc: SceneDocument
  /** Omit to keep the current selection. `null` clears it. */
  selection?: string | null
}

function nextRequirement(
  doc: SceneDocument,
  context: SceneValidationContext,
): { namespace: string; version: string } {
  const available = [
    { namespace: context.builtin.namespace, version: context.builtin.version },
    ...Object.values(context.schemas).map((bundle) => ({
      namespace: bundle.namespace,
      version: bundle.version,
    })),
  ].sort((a, b) => a.namespace.localeCompare(b.namespace))
  const next = available.find(
    (option) => !doc.requires.some((entry) => entry.startsWith(`${option.namespace}@`)),
  )
  if (!next) throw new Error('Every available schema is already required.')
  return next
}

/**
 * Apply one panel command to a scene document. The editor and the shell panels
 * use the same reducer so an edit has identical semantics in both frames.
 */
export function applySceneCommand(
  doc: SceneDocument,
  command: SceneCommand,
  context: SceneValidationContext,
): SceneCommandResult {
  switch (command.type) {
    case 'select':
      return { doc, selection: command.entityId }
    case 'set-scene-id': {
      const next = cloneJson(doc)
      next.id = command.id
      return { doc: next }
    }
    case 'set-requirement': {
      if (command.index < 0 || command.index >= doc.requires.length) {
        throw new Error('That schema requirement no longer exists.')
      }
      const next = cloneJson(doc)
      next.requires[command.index] = command.value
      return { doc: next }
    }
    case 'add-requirement': {
      const option = nextRequirement(doc, context)
      const next = cloneJson(doc)
      next.requires.push(`${option.namespace}@${option.version}`)
      return { doc: next }
    }
    case 'remove-requirement': {
      if (command.index < 0 || command.index >= doc.requires.length) {
        throw new Error('That schema requirement no longer exists.')
      }
      const next = cloneJson(doc)
      next.requires.splice(command.index, 1)
      return { doc: next }
    }
    case 'set-entity-name':
      return { doc: setEntityName(doc, command.entityId, command.value) }
    case 'set-entity-type':
      return {
        doc: withTypeRequirement(
          setEntityType(doc, command.entityId, command.value),
          command.value,
          context,
        ),
      }
    case 'set-entity-scene':
      return { doc: setSceneInstancePath(doc, command.entityId, command.value) }
    case 'set-entity-parent': {
      const parent = entityById(doc, command.parentId)
      if (!parent) throw new Error(`Parent "${command.parentId}" does not exist.`)
      if (entityIsSceneInstance(parent)) {
        const slots = slotNamesForInstance(doc, parent, context)
        if (slots.length === 0) throw new Error('That scene instance exposes no slots.')
        return {
          doc: setEntityParent(doc, command.entityId, command.parentId, slots[0]),
        }
      }
      return { doc: setEntityParent(doc, command.entityId, command.parentId) }
    }
    case 'set-entity-slot': {
      const entity = entityById(doc, command.entityId)
      if (!entity?.parent) throw new Error('The entity has no parent.')
      if (!command.slot) return { doc }
      return {
        doc: setEntityParent(doc, command.entityId, entity.parent, command.slot),
      }
    }
    case 'set-transform':
      return { doc: setEntityTransform(doc, command.entityId, command.transform) }
    case 'set-prop':
      return {
        doc: setEntityProp(doc, command.entityId, command.name, command.value),
      }
    case 'reset-prop':
      return { doc: removeEntityProp(doc, command.entityId, command.name) }
    case 'delete-entity':
      return { doc: deleteEntity(doc, command.entityId), selection: null }
    case 'duplicate-entity': {
      const duplicated = duplicateEntity(doc, command.entityId)
      return { doc: duplicated.scene, selection: duplicated.id }
    }
    case 'add-promotion':
      return {
        doc: addPromotion(doc, command.name, command.target),
      }
    case 'remove-promotion':
      return { doc: removePromotion(doc, command.name) }
    case 'add-slot':
      return { doc: addSlot(doc, command.name, command.entity) }
    case 'remove-slot':
      return { doc: removeSlot(doc, command.name) }
  }
}
