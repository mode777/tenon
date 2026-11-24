import { describe, expect, it } from 'vitest'
import { builtinBundle, type SchemaBundle } from './schema'
import {
  addEntity,
  addPromotion,
  addSceneInstance,
  addSlot,
  composeTransforms,
  createEmptyScene,
  deleteEntity,
  duplicateEntity,
  effectiveForType,
  entityProperties,
  expandScene,
  normalizeTransform,
  parseSceneText,
  referenceEscapesWorkspace,
  resolveScenePath,
  sceneSurface,
  sceneToText,
  setEntityParent,
  setEntityProp,
  validateScene,
  type SceneDocument,
  type SceneValidationContext,
} from './scene'

function gameSchema(): SchemaBundle {
  return {
    id: 'com.example.game',
    version: '1.0.0',
    namespace: 'game',
    definitions: {
      'game:train': {
        fields: { speed: { type: 'float', default: 0 } },
      },
      'game:engine': {
        fields: { power: { type: 'float', default: 1 } },
      },
      'game:button': {
        fields: {
          label: { type: 'string', default: 'Press' },
          target: { type: 'entityRef', scope: 'host', default: null },
        },
        events: { pressed: {} },
      },
    },
  }
}

function context(scenes: Record<string, SceneDocument> = {}): SceneValidationContext {
  return {
    builtin: builtinBundle(),
    schemas: { game: gameSchema() },
    scenes,
    assets: ['/assets/cube.glb'],
  }
}

function trainScene(): SceneDocument {
  return {
    id: 'scene_train',
    requires: ['basic3d@1.0.0', 'game@1.0.0'],
    root: 'root',
    entities: [
      { id: 'root', type: 'game:train', transform: { position: [0, 1, 0] } },
      { id: 'engine', type: 'game:engine', parent: 'root', props: { power: 1 } },
      { id: 'button_anchor', type: 'basic3d:node', parent: 'root' },
    ],
    promotes: {
      power: { entity: 'engine', field: 'power' },
    },
    slots: {
      button_0: { entity: 'button_anchor' },
    },
  }
}

function levelScene(): SceneDocument {
  return {
    id: 'scene_level',
    requires: ['basic3d@1.0.0', 'game@1.0.0'],
    root: 'root',
    entities: [
      { id: 'root', type: 'basic3d:node' },
      {
        id: 'train_1',
        scene: '../scenes/train.scene.json',
        parent: 'root',
        transform: { position: [3, 0, 0] },
        props: { power: 2 },
      },
      { id: 'button_1', type: 'game:button', parent: 'train_1', slot: 'button_0' },
    ],
  }
}

describe('external references', () => {
  it('resolves workspace-absolute and scene-relative paths', () => {
    const scenePath = '/scenes/one.scene.json'
    expect(resolveScenePath('/assets/cube.glb', scenePath)).toBe('/assets/cube.glb')
    expect(resolveScenePath('cube.glb', scenePath)).toBe('/scenes/cube.glb')
    expect(resolveScenePath('../assets/cube.glb', scenePath)).toBe('/assets/cube.glb')
    expect(referenceEscapesWorkspace('../assets/cube.glb', scenePath)).toBe(false)
    expect(referenceEscapesWorkspace('../../assets/cube.glb', scenePath)).toBe(true)
  })

  it('validates scene-relative asset and scene references', () => {
    const assetScene: SceneDocument = {
      id: 'scene_assets',
      requires: ['basic3d@1.0.0'],
      root: 'root',
      entities: [
        { id: 'root', type: 'basic3d:node' },
        {
          id: 'mesh',
          type: 'basic3d:mesh',
          parent: 'root',
          props: { mesh: '../assets/cube.glb' },
        },
      ],
    }
    expect(
      validateScene(assetScene, context(), '/scenes/assets.scene.json').errors,
    ).toBe(0)
    const level = levelScene()
    expect(
      validateScene(
        level,
        context({ '/scenes/train.scene.json': trainScene() }),
        '/levels/level01.scene.json',
      ).errors,
    ).toBe(0)
  })
})

describe('scene document', () => {
  it('creates and round-trips the default scene', () => {
    const scene = createEmptyScene()
    expect(scene.requires).toEqual(['basic3d@1.0.0'])
    expect(scene.entities).toEqual([{ id: 'root', type: 'basic3d:node' }])
    expect(parseSceneText(sceneToText(scene))).toEqual(scene)
  })

  it('validates a clean scene without errors', () => {
    const train = trainScene()
    const level = levelScene()
    const ctx = context({ '/scenes/train.scene.json': train })
    expect(validateScene(train, ctx, '/scenes/train.scene.json').errors).toBe(0)
    expect(validateScene(level, ctx, '/levels/level01.scene.json').errors).toBe(0)
  })

  it('rejects abstract types and missing hierarchy parents', () => {
    const scene: SceneDocument = {
      id: 'scene_broken',
      requires: ['basic3d@1.0.0'],
      root: 'root',
      entities: [
        { id: 'root', type: 'basic3d:renderable' },
        { id: 'child', type: 'basic3d:node', parent: 'missing' },
      ],
    }
    const codes = validateScene(scene, context()).issues.map((issue) => issue.code)
    expect(codes).toContain('abstract-instance')
    expect(codes).toContain('missing-parent')
  })

  it('detects hierarchy cycles and duplicate IDs', () => {
    const scene: SceneDocument = {
      id: 'scene_broken',
      requires: ['basic3d@1.0.0'],
      root: 'root',
      entities: [
        { id: 'root', type: 'basic3d:node' },
        { id: 'a', type: 'basic3d:node', parent: 'b' },
        { id: 'b', type: 'basic3d:node', parent: 'a' },
        { id: 'a', type: 'basic3d:node', parent: 'root' },
      ],
    }
    const codes = validateScene(scene, context()).issues.map((issue) => issue.code)
    expect(codes).toContain('duplicate-entity-id')
    expect(codes).toContain('hierarchy-cycle')
  })

  it('validates transforms and values', () => {
    const scene: SceneDocument = {
      id: 'scene_broken',
      requires: ['basic3d@1.0.0'],
      root: 'root',
      entities: [
        {
          id: 'root',
          type: 'basic3d:node',
          transform: { position: [0, 1] as unknown as [number, number, number] },
        },
        {
          id: 'mesh',
          type: 'basic3d:mesh',
          parent: 'root',
          props: { mesh: 'assets/missing.glb', visible: 'yes' },
        },
      ],
    }
    const issues = validateScene(scene, context()).issues
    expect(issues.some((issue) => issue.code === 'transform-component')).toBe(true)
    expect(issues.some((issue) => issue.code === 'prop-value')).toBe(true)
    expect(issues.some((issue) => issue.code === 'asset-ref')).toBe(true)
    expect(issues.some((issue) => issue.code === 'required-prop')).toBe(false)
  })

  it('reports missing required properties', () => {
    const scene: SceneDocument = {
      id: 'scene_broken',
      requires: ['basic3d@1.0.0'],
      root: 'root',
      entities: [
        { id: 'root', type: 'basic3d:node' },
        { id: 'mesh', type: 'basic3d:mesh', parent: 'root' },
      ],
    }
    expect(
      validateScene(scene, context()).issues.some((issue) => issue.code === 'required-prop'),
    ).toBe(true)
  })
})

describe('scene composition', () => {
  it('promotes direct child fields and exposes slots', () => {
    const train = trainScene()
    const surface = sceneSurface(train, context())
    expect(surface.fields.map((field) => field.name).sort()).toEqual(['power', 'speed'])
    expect(surface.issues).toEqual([])
    expect(Object.keys(train.slots ?? {})).toEqual(['button_0'])
  })

  it('rejects deep promotions', () => {
    const train = trainScene()
    train.entities.push({ id: 'deep', type: 'game:engine', parent: 'engine' })
    train.promotes = { deepPower: { entity: 'deep', field: 'power' } }
    expect(
      validateScene(train, context()).issues.some((issue) => issue.code === 'promotion-direct-child'),
    ).toBe(true)
  })

  it('checks scene instance overrides against the public surface', () => {
    const train = trainScene()
    const level = levelScene()
    level.entities[1].props = { power: 2, speed: 4, internal: 1 }
    const codes = validateScene(
      level,
      context({ '/scenes/train.scene.json': train }),
      '/levels/level01.scene.json',
    ).issues.map((issue) => issue.code)
    expect(codes.filter((code) => code === 'scene-instance-prop')).toHaveLength(1)
  })

  it('requires attachments to use a declared slot', () => {
    const train = trainScene()
    const level = levelScene()
    level.entities[2].slot = 'missing'
    const issues = validateScene(
      level,
      context({ '/scenes/train.scene.json': train }),
      '/levels/level01.scene.json',
    ).issues
    expect(issues.some((issue) => issue.code === 'attachment-slot')).toBe(true)
  })

  it('rejects an entity parented to a scene instance without a slot', () => {
    const train = trainScene()
    const level = levelScene()
    delete level.entities[2].slot
    const issues = validateScene(
      level,
      context({ '/scenes/train.scene.json': train }),
      '/levels/level01.scene.json',
    ).issues
    expect(issues.some((issue) => issue.code === 'attachment-slot')).toBe(true)
  })

  it('detects scene reference cycles', () => {
    const a: SceneDocument = {
      id: 'scene_a',
      requires: ['basic3d@1.0.0'],
      root: 'root',
      entities: [
        { id: 'root', type: 'basic3d:node' },
        { id: 'b', scene: 'b.scene.json', parent: 'root' },
      ],
    }
    const b: SceneDocument = {
      id: 'scene_b',
      requires: ['basic3d@1.0.0'],
      root: 'root',
      entities: [
        { id: 'root', type: 'basic3d:node' },
        { id: 'a', scene: 'a.scene.json', parent: 'root' },
      ],
    }
    const issues = validateScene(
      a,
      context({
        '/scenes/a.scene.json': a,
        '/scenes/b.scene.json': b,
      }),
      '/scenes/a.scene.json',
    ).issues
    expect(issues.some((issue) => issue.code === 'scene-cycle')).toBe(true)
  })

  it('validates required schema versions', () => {
    const scene = createEmptyScene()
    scene.requires = ['basic3d@0.1.0']
    expect(
      validateScene(scene, context()).issues.some(
        (issue) => issue.code === 'scene-requirement-version',
      ),
    ).toBe(true)
  })
})

describe('scene editing', () => {
  it('adds, reparents, duplicates, and deletes entities', () => {
    const scene = createEmptyScene()
    const added = addEntity(scene, 'basic3d:node')
    expect(added.id).toBe('node_1')
    const moved = setEntityParent(added.scene, added.id, 'root')
    expect(moved.entities.find((entity) => entity.id === added.id)?.parent).toBe('root')
    const duplicated = duplicateEntity(moved, added.id)
    expect(duplicated.id).not.toBe(added.id)
    const deleted = deleteEntity(duplicated.scene, added.id)
    expect(deleted.entities.some((entity) => entity.id === added.id)).toBe(false)
    expect(deleted.entities.some((entity) => entity.id === duplicated.id)).toBe(true)
  })

  it('adds scene instances and slots', () => {
    const scene = createEmptyScene()
    const withInstance = addSceneInstance(scene, 'scenes/train.scene.json')
    expect(withInstance.scene.entities.at(-1)).toMatchObject({
      scene: '/scenes/train.scene.json',
      parent: 'root',
    })
    const withSlot = addSlot(withInstance.scene, 'button_0', withInstance.id)
    expect(withSlot.slots?.button_0).toEqual({ entity: withInstance.id })
  })

  it('resolves effective properties from defaults and overrides', () => {
    const train = trainScene()
    const root = train.entities[0]
    const props = entityProperties(train, root, context())
    expect(props.find((prop) => prop.name === 'speed')?.value).toBe(0)
    const changed = setEntityProp(train, 'root', 'speed', 12)
    expect(entityProperties(changed, changed.entities[0], context())[0].value).toBe(12)
  })

  it('adds field promotions', () => {
    const scene = createEmptyScene()
    scene.entities.push({ id: 'engine', type: 'game:engine', parent: 'root' })
    const promoted = addPromotion(scene, 'power', { entity: 'engine', field: 'power' })
    expect(promoted.promotes?.power).toEqual({ entity: 'engine', field: 'power' })
  })
})

describe('transform composition and expansion', () => {
  it('composes parent and child transforms', () => {
    const parent = normalizeTransform({
      position: [3, 0, 0],
      rotation: [0, 90, 0],
      scale: [1, 1, 1],
    })
    const child = normalizeTransform({ position: [1, 0, 0] })
    const world = composeTransforms(parent, child)
    expect(world.position[0]).toBeCloseTo(3, 6)
    expect(world.position[2]).toBeCloseTo(-1, 6)
    expect(world.rotation[1]).toBeCloseTo(90, 6)
  })

  it('expands a scene instance into concrete entities and slot attachments', () => {
    const train = trainScene()
    const level = levelScene()
    const ctx = context({ '/scenes/train.scene.json': train })
    const expanded = expandScene(level, ctx, '/levels/level01.scene.json')
    expect(expanded.issues).toEqual([])
    const byId = new Map(expanded.entities.map((entity) => [entity.id, entity]))
    const root = byId.get('train_1::root')
    const engine = byId.get('train_1::engine')
    const button = byId.get('button_1')
    expect(root?.type).toBe('game:train')
    expect(root?.parent).toBe('root')
    expect(root?.transform.position).toEqual([3, 1, 0])
    expect(engine?.parent).toBe('train_1::root')
    expect(engine?.props.power).toBe(2)
    expect(button?.parent).toBe('train_1::button_anchor')
    expect(expanded.entities.every((entity) => !entity.id.startsWith('scene_'))).toBe(true)
    expect(expanded.entities.every((entity) => entity.type.includes(':'))).toBe(true)
  })

  it('resolves promoted overrides through nested scene instances', () => {
    const train = trainScene()
    const level = levelScene()
    const ctx = context({ '/scenes/train.scene.json': train })
    level.entities[1].transform = { position: [0, 0, 0] }
    level.entities[1].props = { power: 7 }
    const expanded = expandScene(level, ctx, '/levels/level01.scene.json')
    expect(expanded.entities.find((entity) => entity.id === 'train_1::engine')?.props.power).toBe(7)
  })

  it('resolves effective types', () => {
    const surface = effectiveForType('game:engine', context())
    expect(surface.fields.map((field) => field.name)).toEqual(['power'])
  })
})
