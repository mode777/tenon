import { describe, expect, it } from 'vitest'
import { entityById, entityProperties, parseSceneText, sceneToText } from '../core/scene'
import { applySceneCommand } from './scene-commands'
import { contextFor, levelScene } from './panels/panel-test-fixtures'

describe('applySceneCommand', () => {
  it('edits scene identity and requirements', () => {
    const doc = levelScene()
    const context = contextFor(doc)
    const renamed = applySceneCommand(doc, { type: 'set-scene-id', id: 'level_02' }, context)
    expect(renamed.doc.id).toBe('level_02')

    const removed = applySceneCommand(doc, { type: 'remove-requirement', index: 1 }, context)
    expect(removed.doc.requires).toEqual(['basic3d@1.0.0'])
    const added = applySceneCommand(removed.doc, { type: 'add-requirement' }, context)
    expect(added.doc.requires).toContain('game@1.0.0')
  })

  it('edits entity fields, properties, and transforms', () => {
    const doc = levelScene()
    const context = contextFor(doc)
    const named = applySceneCommand(
      doc,
      { type: 'set-entity-name', entityId: 'button_1', value: 'Launch' },
      context,
    )
    expect(entityById(named.doc, 'button_1')?.name).toBe('Launch')

    const withProp = applySceneCommand(
      named.doc,
      { type: 'set-prop', entityId: 'button_1', name: 'label', value: 'Go' },
      context,
    )
    expect(entityProperties(withProp.doc, entityById(withProp.doc, 'button_1')!, context)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'label', value: 'Go' })]),
    )

    const moved = applySceneCommand(
      withProp.doc,
      {
        type: 'set-transform',
        entityId: 'button_1',
        transform: { position: [4, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
      context,
    )
    expect(entityById(moved.doc, 'button_1')?.transform?.position).toEqual([4, 2, 0])
  })

  it('reparents into a scene instance slot and clears it when leaving', () => {
    const doc = levelScene()
    const context = contextFor(doc)
    const attached = applySceneCommand(
      doc,
      { type: 'set-entity-parent', entityId: 'button_1', parentId: 'train_1' },
      context,
    )
    expect(entityById(attached.doc, 'button_1')).toMatchObject({
      parent: 'train_1',
      slot: 'button_0',
    })
    const detached = applySceneCommand(
      attached.doc,
      { type: 'set-entity-parent', entityId: 'button_1', parentId: 'root' },
      context,
    )
    expect(entityById(detached.doc, 'button_1')?.slot).toBeUndefined()
  })

  it('duplicates and deletes entities with selection updates', () => {
    const doc = levelScene()
    const context = contextFor(doc)
    const duplicated = applySceneCommand(
      doc,
      { type: 'duplicate-entity', entityId: 'button_1' },
      context,
    )
    expect(duplicated.selection).toBeTruthy()
    expect(entityById(duplicated.doc, duplicated.selection!)).toBeTruthy()

    const deleted = applySceneCommand(
      duplicated.doc,
      { type: 'delete-entity', entityId: duplicated.selection! },
      context,
    )
    expect(deleted.selection).toBeNull()
    expect(entityById(deleted.doc, duplicated.selection!)).toBeUndefined()
  })

  it('adds entities, scene instances, and assets', () => {
    const doc = levelScene()
    const context = contextFor(doc)

    const withEntity = applySceneCommand(
      doc,
      { type: 'add-entity', definition: 'game:engine', parentId: 'root' },
      context,
    )
    expect(entityById(withEntity.doc, withEntity.selection!)).toMatchObject({
      type: 'game:engine',
      parent: 'root',
    })

    const withInstance = applySceneCommand(
      withEntity.doc,
      {
        type: 'add-scene-instance',
        scenePath: '/scenes/train.scene.json',
        parentId: 'root',
      },
      context,
    )
    expect(entityById(withInstance.doc, withInstance.selection!)).toMatchObject({
      scene: '/scenes/train.scene.json',
      parent: 'root',
    })

    const withAsset = applySceneCommand(
      withEntity.doc,
      { type: 'add-asset', asset: '/assets/cube.glb', parentId: 'root' },
      context,
    )
    expect(entityById(withAsset.doc, withAsset.selection!)).toMatchObject({
      type: 'basic3d:mesh',
      props: { mesh: '/assets/cube.glb' },
    })
  })

  it('adds and removes promotions and slots', () => {
    const doc = levelScene()
    const context = contextFor(doc)
    const promoted = applySceneCommand(
      doc,
      {
        type: 'add-promotion',
        name: 'powerPublic',
        target: { entity: 'train_1', field: 'power' },
      },
      context,
    )
    expect(promoted.doc.promotes?.powerPublic).toEqual({ entity: 'train_1', field: 'power' })

    const slotted = applySceneCommand(
      promoted.doc,
      { type: 'add-slot', name: 'mount_0', entity: 'button_1' },
      context,
    )
    expect(slotted.doc.slots?.mount_0).toEqual({ entity: 'button_1' })

    const removed = applySceneCommand(
      slotted.doc,
      { type: 'remove-promotion', name: 'powerPublic' },
      context,
    )
    expect(removed.doc.promotes?.powerPublic).toBeUndefined()
  })

  it('keeps the document unchanged for selection-only commands', () => {
    const doc = levelScene()
    const result = applySceneCommand(doc, { type: 'select', entityId: 'root' }, contextFor(doc))
    expect(result.doc).toBe(doc)
    expect(result.selection).toBe('root')
  })

  it('round-trips the edited document through the scene serializer', () => {
    const doc = levelScene()
    const context = contextFor(doc)
    const edited = applySceneCommand(
      doc,
      { type: 'set-scene-id', id: 'level_02' },
      context,
    ).doc
    expect(parseSceneText(sceneToText(edited)).id).toBe('level_02')
  })

  it('rejects edits to the scene root', () => {
    const doc = levelScene()
    const context = contextFor(doc)
    expect(() =>
      applySceneCommand(doc, { type: 'delete-entity', entityId: 'root' }, context),
    ).toThrow('The scene root cannot be deleted.')
  })
})
