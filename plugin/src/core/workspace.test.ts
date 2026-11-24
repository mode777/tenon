import { describe, expect, it } from 'vitest'
import { hashText } from './project'
import { loadWorkspace, type WorkspaceClient } from './workspace'

function fakeClient(files: Record<string, string>): WorkspaceClient {
  return {
    capabilities: { directoryListing: true },
    readFile: async (path: string) => {
      if (!(path in files)) throw new Error(`not found: ${path}`)
      return { text: files[path] }
    },
    listDirectory: async (path: string) => {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const direct = new Map<string, 'file' | 'directory'>()
      for (const filePath of Object.keys(files)) {
        if (!filePath.startsWith(prefix)) continue
        const rest = filePath.slice(prefix.length)
        if (!rest) continue
        const [head, ...tail] = rest.split('/')
        direct.set(`${prefix}${head}`, tail.length > 0 ? 'directory' : 'file')
      }
      return {
        entries: [...direct.entries()].map(([entryPath, kind]) => ({
          path: entryPath,
          kind,
          ...(kind === 'file' ? { size: files[entryPath].length } : {}),
        })),
      }
    },
  }
}

const project = JSON.stringify({ imports: { game: 'schemas/game.schema.json' } })
const schema = JSON.stringify({
  id: 'com.example.game',
  version: '1.0.0',
  namespace: 'game',
  definitions: { 'game:thing': { fields: {} } },
})
const scene = JSON.stringify({
  id: 'scene_train',
  requires: ['basic3d@1.0.0'],
  root: 'root',
  entities: [{ id: 'root', type: 'basic3d:node' }],
})

describe('workspace loader', () => {
  it('loads the manifest, schemas, scenes, and assets', async () => {
    const workspace = await loadWorkspace(
      fakeClient({
        '/project.json': project,
        '/schemas/game.schema.json': schema,
        '/scenes/train.scene.json': scene,
        '/levels/level01.scene.json': scene,
        '/assets/cube.glb': 'glb',
      }),
    )
    expect(workspace.manifestError).toBeNull()
    expect(workspace.manifest).toEqual({ imports: { game: 'schemas/game.schema.json' } })
    expect(workspace.schemaPackages).toHaveLength(1)
    expect(workspace.schemaPackages[0].bundle?.namespace).toBe('game')
    expect(workspace.schemaPackages[0].hash).toBe(hashText(schema))
    expect(workspace.scenePackages.map((item) => item.path).sort()).toEqual([
      '/levels/level01.scene.json',
      '/scenes/train.scene.json',
    ])
    expect(workspace.assets).toEqual(['/assets/cube.glb'])
    expect(workspace.assetsKnown).toBe(true)
    expect(workspace.issues).toEqual([])
  })

  it('records parse errors instead of failing the whole workspace', async () => {
    const workspace = await loadWorkspace(
      fakeClient({
        '/project.json': project,
        '/schemas/game.schema.json': '{ not json',
        '/scenes/train.scene.json': '{ nope',
      }),
    )
    expect(workspace.schemaPackages[0].error).toBeTruthy()
    expect(workspace.scenePackages[0].error).toBeTruthy()
  })

  it('opens without project.json when imports are discovered', async () => {
    const workspace = await loadWorkspace(
      fakeClient({
        '/schemas/game.schema.json': schema,
        '/scenes/train.scene.json': scene,
      }),
    )
    expect(workspace.manifest).toBeNull()
    expect(workspace.scenePackages).toHaveLength(1)
    expect(workspace.schemaPackages).toHaveLength(1)
  })
})
