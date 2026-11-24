import { ExoProtocolError, type ViewClient } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { followTheme } from '@exo/plugin-sdk/theme'
import '@exo/plugin-sdk/theme.css'
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { schemaTemplateText } from '../core/schema'
import { sceneTemplateText } from '../core/scene'
import './project.css'

interface ProjectFile {
  path: string
  name: string
  size?: number
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

function errorMessage(error: unknown): string {
  if (error instanceof ExoProtocolError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

async function listFiles(client: ViewClient, directory: string, suffix: string): Promise<ProjectFile[]> {
  if (!client.capabilities.directoryListing) return []
  const files: ProjectFile[] = []
  let cursor: string | undefined
  try {
    do {
      const page = await client.listDirectory(directory, cursor ? { cursor } : {})
      for (const entry of page.entries) {
        if (entry.kind === 'file' && entry.path.endsWith(suffix)) {
          files.push({ path: entry.path, name: fileName(entry.path), size: entry.size })
        }
      }
      cursor = page.nextCursor
    } while (cursor)
  } catch (error) {
    if (error instanceof ExoProtocolError && error.code === 'not-found') return []
    throw error
  }
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

interface HubState {
  schemas: ProjectFile[]
  scenes: ProjectFile[]
  levels: ProjectFile[]
}

const EMPTY_STATE: HubState = { schemas: [], scenes: [], levels: [] }

export function ProjectHub({ client }: { client: ViewClient }) {
  const [files, setFiles] = useState<HubState>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const canWrite = client.capabilities.write && client.initialization.permissions.includes('workspace:write')
  const canCreate = canWrite && client.capabilities.createFile
  const canList = client.capabilities.directoryListing

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [schemas, scenes, levels] = await Promise.all([
        listFiles(client, '/schemas', '.schema.json'),
        listFiles(client, '/scenes', '.scene.json'),
        listFiles(client, '/levels', '.scene.json'),
      ])
      setFiles({ schemas, scenes, levels })
    } catch (cause) {
      if (cause instanceof ExoProtocolError && cause.code === 'not-found') {
        setFiles(EMPTY_STATE)
      } else {
        setError(errorMessage(cause))
      }
    } finally {
      setLoading(false)
    }
  }

  const openFile = async (path: string) => {
    try {
      await client.openFile(path)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const pickFile = async (directory: string) => {
    setBusy(true)
    setError(null)
    try {
      if (!client.capabilities.filePicker) {
        throw new Error('This Exo shell does not offer a workspace file picker.')
      }
      const paths = await client.requestFiles({ directory })
      if (paths.length > 0) await client.openFile(paths[0])
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const createFile = async (
    kind: 'schema' | 'scene',
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!canCreate) {
      return {
        ok: false,
        message: canWrite
          ? 'This Exo shell does not support file creation.'
          : 'The workspace is read-only.',
      }
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const created =
        kind === 'schema'
          ? await client.requestNewFile({
              text: schemaTemplateText(),
              suggestedName: 'new.schema.json',
              directory: '/schemas',
            })
          : await client.requestNewFile({
              text: sceneTemplateText(),
              suggestedName: 'new.scene.json',
              directory: '/scenes',
            })
      if (!created) return { ok: true }
      setNotice(`Created ${created.path}`)
      setFiles((current) => {
        const key: keyof HubState =
          kind === 'schema'
            ? 'schemas'
            : created.path.startsWith('/levels/')
              ? 'levels'
              : 'scenes'
        return {
          ...current,
          [key]: [
            ...current[key].filter((item) => item.path !== created.path),
            { path: created.path, name: fileName(created.path) },
          ].sort((a, b) => a.name.localeCompare(b.name)),
        }
      })
      await client.openFile(created.path)
      return { ok: true }
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      return { ok: false, message }
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    const offCommand = client.onCommand(async (invocation) => {
      if (invocation.command === 'tenon.new-schema') return createFile('schema')
      if (invocation.command === 'tenon.new-scene') return createFile('scene')
      return { ok: false, message: `Unknown Tenon command: ${invocation.command}` }
    })
    const offDispose = client.onDispose(() => {
      offCommand()
      offDispose()
    })
    return () => {
      offCommand()
      offDispose()
    }
    // The panel is a singleton frame; the client is stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const total = files.schemas.length + files.scenes.length + files.levels.length
  const empty = !loading && total === 0
  const subtitle = useMemo(() => {
    if (loading) return 'Reading project…'
    return `${files.schemas.length} schemas · ${files.scenes.length} scenes · ${files.levels.length} levels`
  }, [loading, files])

  return (
    <main className="project-shell">
      <header className="project-header">
        <div className="brand-mark" aria-hidden="true">T</div>
        <div className="brand-copy">
          <h1>Tenon</h1>
          <p>Schema-first authoring</p>
        </div>
      </header>

      <section className="project-body">
        <div className="section-heading">
          <div>
            <h2>Project</h2>
            <p>{subtitle}</p>
          </div>
          <div className="heading-actions">
            <button
              type="button"
              className="button ghost"
              onClick={() => void openFile('/project.json')}
            >
              Project settings
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => void pickFile('/schemas')}
              disabled={busy || !client.capabilities.filePicker}
            >
              Open…
            </button>
          </div>
        </div>

        {!canCreate && (
          <div className="banner muted" role="status">
            {canWrite
              ? 'This shell does not support creating files. Open an existing document or update Exo.'
              : 'This workspace is read-only. Authoring is disabled.'}
          </div>
        )}
        {!canList && (
          <div className="banner muted" role="status">
            Directory listing is unavailable in this shell. Use Open… to choose a document.
          </div>
        )}
        {error && (
          <div className="banner danger" role="alert">
            <span>{error}</span>
            <button type="button" className="link-button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div className="banner success" role="status">
            <span>{notice}</span>
            <button type="button" className="link-button" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}

        {loading ? (
          <div className="empty-state"><span className="spinner" /> Loading project…</div>
        ) : empty ? (
          <div className="empty-state">
            <div className="empty-glyph" aria-hidden="true">◇</div>
            <h3>No schemas or scenes yet</h3>
            <p>Start with a schema bundle, then create a scene that uses its definitions.</p>
            <div className="empty-actions">
              <button
                type="button"
                className="button primary"
                onClick={() => void createFile('schema')}
                disabled={busy || !canCreate}
              >
                Create the first schema
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => void createFile('scene')}
                disabled={busy || !canCreate}
              >
                Create a scene
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="hub-section">
              <div className="section-heading compact">
                <div>
                  <h3>Schemas</h3>
                  <p>Versioned definitions, composition, fields, and events.</p>
                </div>
                <div className="heading-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void createFile('schema')}
                    disabled={busy || !canCreate}
                  >
                    New Schema
                  </button>
                </div>
              </div>
              {files.schemas.length === 0 ? (
                <div className="empty-state compact">
                  <h3>No schema bundles yet</h3>
                  <p>Define the entity vocabulary for scenes.</p>
                </div>
              ) : (
                <ul className="schema-list">
                  {files.schemas.map((schema) => (
                    <li key={schema.path}>
                      <button type="button" className="schema-row" onClick={() => void openFile(schema.path)}>
                        <span className="schema-icon" aria-hidden="true">◈</span>
                        <span className="schema-copy">
                          <strong>{schema.name}</strong>
                          <small>{schema.path}</small>
                        </span>
                        <span className="schema-open">Open</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="hub-section">
              <div className="section-heading compact">
                <div>
                  <h3>Scenes</h3>
                  <p>Reusable entity hierarchies with promotions and slots.</p>
                </div>
                <div className="heading-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void createFile('scene')}
                    disabled={busy || !canCreate}
                  >
                    New Scene
                  </button>
                </div>
              </div>
              {files.scenes.length === 0 ? (
                <div className="empty-state compact">
                  <h3>No scenes yet</h3>
                  <p>Create a scene, then instance it in a level.</p>
                </div>
              ) : (
                <ul className="schema-list">
                  {files.scenes.map((scene) => (
                    <li key={scene.path}>
                      <button type="button" className="schema-row" onClick={() => void openFile(scene.path)}>
                        <span className="schema-icon scene-icon" aria-hidden="true">◇</span>
                        <span className="schema-copy">
                          <strong>{scene.name}</strong>
                          <small>{scene.path}</small>
                        </span>
                        <span className="schema-open">Open</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="hub-section">
              <div className="section-heading compact">
                <div>
                  <h3>Levels</h3>
                  <p>The top-level world. Same scene format, level controls.</p>
                </div>
              </div>
              {files.levels.length === 0 ? (
                <div className="empty-state compact">
                  <h3>No levels yet</h3>
                  <p>A level is a scene document under <code>levels/</code>.</p>
                </div>
              ) : (
                <ul className="schema-list">
                  {files.levels.map((level) => (
                    <li key={level.path}>
                      <button type="button" className="schema-row" onClick={() => void openFile(level.path)}>
                        <span className="schema-icon level-icon" aria-hidden="true">◆</span>
                        <span className="schema-copy">
                          <strong>{level.name}</strong>
                          <small>{level.path}</small>
                        </span>
                        <span className="schema-open">Open</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      <footer className="project-footer">
        <span>M2 · Project and scene editors</span>
        <span>Exo {client.initialization.shell.version}</span>
      </footer>
    </main>
  )
}

async function main(): Promise<void> {
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root.')

  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'view') {
    throw new Error('The Tenon project hub must be mounted in view mode.')
  }

  if (connection.view.view.id !== 'tenon.project') {
    throw new Error(`Unexpected Tenon panel: ${connection.view.view.id}`)
  }

  await followTheme(connection.view)

  connection.view.onError((error) => {
    console.error('TENON_PROJECT_ERROR', error)
  })

  createRoot(root).render(
    <StrictMode>
      <ProjectHub client={connection.view} />
    </StrictMode>,
  )
}

if (document.getElementById('root')) {
  main().catch((error: unknown) => {
    const message = errorMessage(error)
    const root = document.getElementById('root')
    if (root) {
      root.innerHTML = '<main class="project-shell"><div class="banner danger" role="alert">Tenon failed to start: ' +
        message.replaceAll('&', '&amp;').replaceAll('<', '&lt;') +
        '</div></main>'
    }
    console.error('TENON_PROJECT_BOOT_ERROR', error)
  })
}
