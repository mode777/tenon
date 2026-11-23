import { ExoProtocolError, type ViewClient } from '@exo/plugin-sdk'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { followTheme } from '@exo/plugin-sdk/theme'
import '@exo/plugin-sdk/theme.css'
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { schemaTemplateText } from '../core/schema'
import './project.css'

interface SchemaFile {
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

async function listSchemas(client: ViewClient): Promise<SchemaFile[]> {
  if (!client.capabilities.directoryListing) return []
  const files: SchemaFile[] = []
  let cursor: string | undefined
  do {
    const page = await client.listDirectory('/schemas', cursor ? { cursor } : {})
    for (const entry of page.entries) {
      if (entry.kind === 'file' && entry.path.endsWith('.schema.json')) {
        files.push({ path: entry.path, name: fileName(entry.path), size: entry.size })
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

export function ProjectHub({ client }: { client: ViewClient }) {
  const [schemas, setSchemas] = useState<SchemaFile[]>([])
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
      setSchemas(await listSchemas(client))
    } catch (cause) {
      if (cause instanceof ExoProtocolError && cause.code === 'not-found') {
        setSchemas([])
      } else {
        setError(errorMessage(cause))
      }
    } finally {
      setLoading(false)
    }
  }

  const openSchema = async (path: string) => {
    try {
      await client.openFile(path)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const pickSchema = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!client.capabilities.filePicker) {
        throw new Error('This Exo shell does not offer a workspace file picker.')
      }
      const paths = await client.requestFiles({ directory: '/schemas' })
      if (paths.length > 0) await client.openFile(paths[0])
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const createSchema = async (): Promise<{ ok: true } | { ok: false; message: string }> => {
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
      const created = await client.requestNewFile({
        text: schemaTemplateText(),
        suggestedName: 'new.schema.json',
        directory: '/schemas',
      })
      if (!created) return { ok: true }
      setNotice(`Created ${created.path}`)
      setSchemas((current) => [
        ...current.filter((item) => item.path !== created.path),
        { path: created.path, name: fileName(created.path) },
      ].sort((a, b) => a.name.localeCompare(b.name)))
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
      if (invocation.command !== 'tenon.new-schema') {
        return { ok: false, message: `Unknown Tenon command: ${invocation.command}` }
      }
      return createSchema()
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

  const empty = !loading && schemas.length === 0
  const subtitle = useMemo(() => {
    if (loading) return 'Reading schemas…'
    if (schemas.length === 1) return '1 schema bundle'
    return `${schemas.length} schema bundles`
  }, [loading, schemas.length])

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
            <h2>Schemas</h2>
            <p>{subtitle}</p>
          </div>
          <div className="heading-actions">
            <button type="button" className="button ghost" onClick={() => void pickSchema()} disabled={busy || !client.capabilities.filePicker}>
              Open…
            </button>
            <button type="button" className="button primary" onClick={() => void createSchema()} disabled={busy || !canCreate}>
              New Schema
            </button>
          </div>
        </div>

        {!canCreate && (
          <div className="banner muted" role="status">
            {canWrite
              ? 'This shell does not support creating files. Open an existing schema or update Exo.'
              : 'This workspace is read-only. Schema authoring is disabled.'}
          </div>
        )}
        {!canList && (
          <div className="banner muted" role="status">
            Directory listing is unavailable in this shell. Use Open… to choose a schema.
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
          <div className="empty-state"><span className="spinner" /> Loading schemas…</div>
        ) : empty ? (
          <div className="empty-state">
            <div className="empty-glyph" aria-hidden="true">◇</div>
            <h3>No schema bundles yet</h3>
            <p>Start with a schema bundle. It defines the entity vocabulary for scenes.</p>
            <button type="button" className="button primary" onClick={() => void createSchema()} disabled={busy || !canCreate}>
              Create the first schema
            </button>
          </div>
        ) : (
          <ul className="schema-list">
            {schemas.map((schema) => (
              <li key={schema.path}>
                <button type="button" className="schema-row" onClick={() => void openSchema(schema.path)}>
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
      </section>

      <footer className="project-footer">
        <span>M1 · Schema editor</span>
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
