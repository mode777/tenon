import { describe, expect, it } from 'vitest'
import { builtinBundle, schemaToText, type SchemaBundle } from './schema'
import {
  analyzeProject,
  hashText,
  parseImportLocation,
  parseProjectText,
  projectBuildCommand,
  projectToText,
  type ProjectSchemaPackage,
  type ProjectScenePackage,
} from './project'
import { sceneToText, type SceneDocument } from './scene'

function gameSchema(): SchemaBundle {
  return {
    id: 'com.example.game',
    version: '1.0.0',
    namespace: 'game',
    definitions: {
      'game:train': {
        fields: { speed: { type: 'float', default: 0 } },
      },
    },
  }
}

function trainScene(): SceneDocument {
  return {
    id: 'scene_train',
    requires: ['basic3d@1.0.0', 'game@1.0.0'],
    root: 'root',
    entities: [
      { id: 'root', type: 'game:train' },
    ],
  }
}

function schemaPackage(bundle: SchemaBundle, path = '/schemas/game.schema.json'): ProjectSchemaPackage {
  const text = schemaToText(bundle)
  return { path, source: 'local', text, hash: hashText(text), bundle }
}

function scenePackage(scene: SceneDocument, path = '/scenes/train.scene.json'): ProjectScenePackage {
  const text = sceneToText(scene)
  return { path, text, hash: hashText(text), scene }
}

describe('project manifest', () => {
  it('parses and round-trips the import map', () => {
    const manifest = { imports: { game: 'schemas/game.schema.json' } }
    expect(parseProjectText(projectToText(manifest))).toEqual(manifest)
  })

  it('parses supported locations', () => {
    expect(parseImportLocation('builtin:basic3d@1.0.0')).toEqual({
      kind: 'builtin',
      namespace: 'basic3d',
      version: '1.0.0',
    })
    expect(parseImportLocation('schemas/game.schema.json')).toEqual({
      kind: 'local',
      path: '/schemas/game.schema.json',
    })
    expect(parseImportLocation('https://schemas.example.com/game.schema.json')).toEqual({
      kind: 'remote',
      url: 'https://schemas.example.com/game.schema.json',
    })
    expect(parseImportLocation('file:///tmp/game.schema.json').kind).toBe('invalid')
    expect(parseImportLocation('../game.schema.json').kind).toBe('invalid')
  })

  it('hashes content stably', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abcd'))
  })
})

describe('project analysis', () => {
  it('resolves a clean project', () => {
    const analysis = analyzeProject(
      { imports: { game: 'schemas/game.schema.json' } },
      [schemaPackage(gameSchema())],
      [scenePackage(trainScene())],
      builtinBundle(),
    )
    expect(analysis.errors).toBe(0)
    expect(analysis.ready).toBe(true)
    expect(analysis.schemas.map((row) => row.namespace)).toEqual(['basic3d', 'game'])
    expect(analysis.schemasByNamespace.game.version).toBe('1.0.0')
  })

  it('reports missing imports and wrong bundle namespaces', () => {
    const shared: SchemaBundle = {
      id: 'com.example.shared',
      version: '1.0.0',
      namespace: 'shared',
      definitions: {},
    }
    const analysis = analyzeProject(
      {
        imports: {
          game: 'schemas/other.schema.json',
          other: 'schemas/missing.schema.json',
        },
      },
      [schemaPackage(shared, '/schemas/other.schema.json')],
      [],
      builtinBundle(),
    )
    const codes = analysis.issues.map((issue) => issue.code)
    expect(codes).toContain('project-import-bundle')
    expect(codes).toContain('project-import-missing')
    expect(analysis.ready).toBe(false)
  })

  it('requires every imported namespace to be mapped', () => {
    const shared: SchemaBundle = {
      id: 'com.example.shared',
      version: '1.0.0',
      namespace: 'shared',
      definitions: {},
    }
    const game = gameSchema()
    game.imports = { shared: '1.0.0' }
    game.definitions['game:train'].compose = ['shared:base']
    shared.definitions['shared:base'] = { fields: { weight: { type: 'float', default: 1 } } }
    const analysis = analyzeProject(
      { imports: { game: 'schemas/game.schema.json' } },
      [
        schemaPackage(game),
        schemaPackage(shared, '/schemas/shared.schema.json'),
      ],
      [],
      builtinBundle(),
    )
    expect(analysis.issues.some((issue) => issue.code === 'unmapped-import')).toBe(true)
    expect(analysis.ready).toBe(false)
  })

  it('reports scenes whose required namespace is missing from the map', () => {
    const analysis = analyzeProject(
      { imports: {} },
      [schemaPackage(gameSchema())],
      [scenePackage(trainScene())],
      builtinBundle(),
    )
    expect(analysis.issues.some((issue) => issue.code === 'project-scene-import')).toBe(true)
    expect(analysis.ready).toBe(false)
  })

  it('validates scene requirements against the project versions', () => {
    const scene = trainScene()
    scene.requires = ['basic3d@1.0.0', 'game@2.0.0']
    const analysis = analyzeProject(
      { imports: { game: 'schemas/game.schema.json' } },
      [schemaPackage(gameSchema())],
      [scenePackage(scene)],
      builtinBundle(),
    )
    expect(
      analysis.issues.some((issue) => issue.code === 'scene-requirement-version'),
    ).toBe(true)
  })

  it('builds a deterministic build command', () => {
    expect(projectBuildCommand('/levels/level01.scene.json')).toBe(
      'tenon build levels/level01.scene.json',
    )
  })
})
