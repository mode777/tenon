import { hashText } from '../../core/project'
import type { SchemaBundle } from '../../core/schema'
import {
  normalizeScenePath,
  type SceneDocument,
  type SceneValidationContext,
} from '../../core/scene'
import type { LoadedWorkspace } from '../../core/workspace'
import { sceneValidationContext } from '../scene-workspace'

export function gameSchema(): SchemaBundle {
  return {
    id: 'com.example.game',
    version: '1.0.0',
    namespace: 'game',
    definitions: {
      'game:train': { fields: { speed: { type: 'float', default: 0 } } },
      'game:engine': { fields: { power: { type: 'float', default: 1 } } },
      'game:button': {
        fields: { label: { type: 'string', default: 'Press' } },
        events: { pressed: {} },
      },
    },
  }
}

export function trainScene(): SceneDocument {
  return {
    id: 'scene_train',
    requires: ['basic3d@1.0.0', 'game@1.0.0'],
    root: 'root',
    entities: [
      { id: 'root', type: 'game:train', transform: { position: [0, 1, 0] } },
      { id: 'engine', type: 'game:engine', parent: 'root' },
      { id: 'button_anchor', type: 'basic3d:node', parent: 'root' },
    ],
    promotes: { power: { entity: 'engine', field: 'power' } },
    slots: { button_0: { entity: 'button_anchor' } },
  }
}

export function levelScene(): SceneDocument {
  return {
    id: 'scene_level',
    requires: ['basic3d@1.0.0', 'game@1.0.0'],
    root: 'root',
    entities: [
      { id: 'root', type: 'basic3d:node' },
      {
        id: 'train_1',
        scene: '/scenes/train.scene.json',
        parent: 'root',
        transform: { position: [3, 0, 0] },
        props: { power: 2 },
      },
      { id: 'button_1', type: 'game:button', parent: 'train_1', slot: 'button_0' },
    ],
  }
}

export function workspace(train = trainScene()): LoadedWorkspace {
  const schema = gameSchema()
  const schemaText = JSON.stringify(schema)
  const sceneText = JSON.stringify(train)
  return {
    manifest: { imports: { game: 'schemas/game.schema.json' } },
    manifestText: '{}',
    manifestError: null,
    schemaPackages: [
      {
        path: '/schemas/game.schema.json',
        source: 'local',
        text: schemaText,
        hash: hashText(schemaText),
        bundle: schema,
      },
    ],
    scenePackages: [
      {
        path: '/scenes/train.scene.json',
        text: sceneText,
        hash: hashText(sceneText),
        scene: train,
      },
    ],
    assets: ['/assets/cube.glb'],
    assetsKnown: true,
    issues: [],
  }
}

export function contextFor(
  doc: SceneDocument,
  loaded: LoadedWorkspace = workspace(),
  path = '/levels/level01.scene.json',
): SceneValidationContext {
  return sceneValidationContext(loaded, doc, normalizeScenePath(path))
}
