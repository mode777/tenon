import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { analyzeProject, hashText, parseProjectText, type ProjectScenePackage, type ProjectSchemaPackage } from './project'
import { builtinBundle, parseSchemaText } from './schema'
import { expandScene, normalizeScenePath, parseSceneText } from './scene'

const root = resolve(import.meta.dirname, '../../../examples/m2-workspace')
const m1Root = resolve(import.meta.dirname, '../../../examples/m1-workspace')

function schemaPackage(path: string): ProjectSchemaPackage {
  const text = readFileSync(resolve(root, path), 'utf8')
  return {
    path: `/${path}`,
    source: 'local',
    text,
    hash: hashText(text),
    bundle: parseSchemaText(text),
  }
}

function scenePackage(path: string): ProjectScenePackage {
  const text = readFileSync(resolve(root, path), 'utf8')
  return {
    path: `/${path}`,
    text,
    hash: hashText(text),
    scene: parseSceneText(text),
  }
}

describe('M2 example workspace', () => {
  const manifest = parseProjectText(readFileSync(resolve(root, 'project.json'), 'utf8'))
  const schemas = [
    schemaPackage('schemas/gameA.schema.json'),
    schemaPackage('schemas/shared.schema.json'),
  ]
  const scenes = [
    scenePackage('scenes/train.scene.json'),
    scenePackage('levels/level01.scene.json'),
  ]

  it('validates end to end', () => {
    const analysis = analyzeProject(manifest, schemas, scenes, builtinBundle(), ['/assets/cube.glb'])
    expect(analysis.issues).toEqual([])
    expect(analysis.errors).toBe(0)
    expect(analysis.ready).toBe(true)
    expect(analysis.schemas.map((row) => row.namespace).sort()).toEqual([
      'basic3d',
      'gameA',
      'shared',
    ])
  })

  it('resolves the train instance and slot attachment', () => {
    const train = scenes.find((item) => item.path === '/scenes/train.scene.json')!.scene!
    const level = scenes.find((item) => item.path === '/levels/level01.scene.json')!.scene!
    const analysis = analyzeProject(manifest, schemas, scenes, builtinBundle())
    const context = {
      builtin: builtinBundle(),
      schemas: analysis.schemasByNamespace,
      scenes: {
        ...analysis.scenesByPath,
        [normalizeScenePath('/levels/level01.scene.json')]: level,
        [normalizeScenePath('/scenes/train.scene.json')]: train,
      },
      assets: ['/assets/cube.glb'],
    }
    const expanded = expandScene(level, context, '/levels/level01.scene.json')
    expect(expanded.issues).toEqual([])
    const byId = new Map(expanded.entities.map((entity) => [entity.id, entity]))
    expect(byId.get('train_1::engine')?.props.power).toBe(2)
    expect(byId.get('train_1::engine')?.props.target).toBe('button_1')
    expect(byId.get('train_1::root')?.props.tone).toBe('cool')
    expect(byId.get('train_1::button_anchor')?.type).toBe('basic3d:node')
    expect(byId.get('button_1')?.parent).toBe('train_1::button_anchor')
    expect(byId.has('train_1')).toBe(false)
  })

  it('ships a valid GLB asset', async () => {
    const glb = readFileSync(resolve(root, 'assets/cube.glb'))
    expect(glb.readUInt32LE(0)).toBe(0x46546c67)
    expect(glb.readUInt32LE(4)).toBe(2)
    expect(glb.readUInt32LE(8)).toBe(glb.length)
    const bytes = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength)
    const loader = new GLTFLoader()
    const scene = await new Promise<Awaited<ReturnType<GLTFLoader['parseAsync']>>>(
      (resolveScene, reject) => {
        loader.parse(bytes, '', resolveScene, reject)
      },
    )
    expect(scene.scene.children).toHaveLength(1)
  })

  it('keeps the M1 workspace valid in the project editor', () => {
    const m1Manifest = parseProjectText(readFileSync(resolve(m1Root, 'project.json'), 'utf8'))
    const m1Schemas = ['schemas/gameA.schema.json', 'schemas/shared.schema.json'].map((path) => {
      const text = readFileSync(resolve(m1Root, path), 'utf8')
      return {
        path: `/${path}`,
        source: 'local' as const,
        text,
        hash: hashText(text),
        bundle: parseSchemaText(text),
      }
    })
    const analysis = analyzeProject(m1Manifest, m1Schemas, [], builtinBundle())
    expect(analysis.issues).toEqual([])
    expect(analysis.ready).toBe(true)
  })
})
