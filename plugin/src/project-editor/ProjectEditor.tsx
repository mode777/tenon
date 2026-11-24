import type { EditorClient } from '@exo/plugin-sdk'
import { ExoProtocolError, type FileChangedPayload } from '@exo/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { builtinBundle, type ValidationIssue } from '../core/schema'
import { useHistory } from '../core/history'
import {
  analyzeProject,
  parseProjectText,
  projectBuildCommand,
  projectToText,
  type ProjectAnalysis,
  type ProjectManifest,
  type ProjectSchemaRow,
} from '../core/project'
import type { LoadedWorkspace } from '../core/workspace'
import { normalizeScenePath } from '../core/scene'
import './project-editor.css'

export interface ProjectEditorProps {
  client: EditorClient
  initialManifest: ProjectManifest
  canWrite: boolean
  workspace: LoadedWorkspace
}

function errorMessage(error: unknown): string {
  if (error instanceof ExoProtocolError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

function sourceLabel(row: ProjectSchemaRow): string {
  if (row.status === 'unmapped') return 'Unmapped'
  if (row.status === 'missing') return 'Missing'
  if (row.status === 'invalid') return 'Invalid'
  if (row.source === 'builtin') return 'Builtin'
  if (row.source === 'remote') return 'Remote'
  return 'Local'
}

function issueTarget(issue: ValidationIssue): string | null {
  if (issue.scenePath) return issue.scenePath
  if (issue.sourcePath && issue.sourcePath !== '/project.json') return issue.sourcePath
  return null
}

export function ProjectEditor({
  client,
  initialManifest,
  canWrite,
  workspace,
}: ProjectEditorProps) {
  const builtin = useMemo(() => builtinBundle(), [])
  const history = useHistory(initialManifest, (value) => JSON.parse(JSON.stringify(value)) as ProjectManifest)
  const manifest = history.state.doc
  const [savedText, setSavedText] = useState(() => projectToText(initialManifest))
  const [newNamespace, setNewNamespace] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [errorToast, setErrorToast] = useState<string | null>(null)
  const [external, setExternal] = useState<FileChangedPayload | null>(null)
  const pathRef = useRef('/project.json')
  const pendingSaveRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const docRef = useRef(manifest)

  const serialized = projectToText(manifest)
  const dirty = serialized !== savedText
  dirtyRef.current = dirty
  docRef.current = manifest

  const analysis = useMemo<ProjectAnalysis>(
    () =>
      analyzeProject(
        manifest,
        workspace.schemaPackages,
        workspace.scenePackages,
        builtin,
        workspace.assetsKnown ? workspace.assets : undefined,
      ),
    [manifest, workspace.schemaPackages, workspace.scenePackages, workspace.assets, workspace.assetsKnown, builtin],
  )
  const imports = manifest.imports ?? {}
  const unmapped = analysis.schemas.filter((row) => row.status === 'unmapped')
  const level = workspace.scenePackages.find((item) => normalizeScenePath(item.path).startsWith('/levels/'))
  const command = level ? projectBuildCommand(level.path) : null

  const showToast = (message: string) => {
    setErrorToast(null)
    setToast(message)
  }
  const showError = (error: unknown) => {
    setToast(null)
    setErrorToast(errorMessage(error))
  }

  useEffect(() => {
    client.setDirty(dirty)
  }, [client, dirty])

  useEffect(() => {
    if (!toast && !errorToast) return
    const timer = window.setTimeout(() => {
      setToast(null)
      setErrorToast(null)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [toast, errorToast])

  useEffect(() => {
    const offSave = client.onSaveRequest(() => {
      const text = projectToText(docRef.current)
      pendingSaveRef.current = text
      return { text }
    })
    const offResult = client.onSaveResult((result) => {
      if (result.ok) {
        setSavedText(pendingSaveRef.current ?? projectToText(docRef.current))
        pendingSaveRef.current = null
        setToast('Saved')
      } else {
        setErrorToast(`${result.code}: ${result.message ?? 'The shell could not save project.json.'}`)
      }
    })
    const offChanged = client.onFileChanged((change) => {
      if (change.kind === 'renamed') pathRef.current = change.path
      if (change.kind === 'deleted' || dirtyRef.current) {
        setExternal(change)
        return
      }
      void reload(false)
    })
    const offError = client.onError((error) => {
      setErrorToast(`${error.code}: ${error.message ?? 'Shell error'}`)
    })
    const offDispose = client.onDispose(() => {
      // The SDK acknowledges dispose; the frame is closing.
    })
    return () => {
      offSave()
      offResult()
      offChanged()
      offError()
      offDispose()
    }
    // The client is stable for the frame lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const reload = async (force: boolean) => {
    if (!force && dirtyRef.current) {
      setExternal({ kind: 'changed', path: pathRef.current })
      return
    }
    try {
      const content = await client.readFile(pathRef.current, 'utf8')
      const next = parseProjectText(content.text)
      history.reset(next)
      setSavedText(projectToText(next))
      setExternal(null)
      setToast('Reloaded project.json')
    } catch (cause) {
      showError(cause)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        client.requestSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [client])

  const setLocation = (namespace: string, location: string) => {
    history.update((draft) => {
      draft.imports = { ...(draft.imports ?? {}), [namespace]: location }
    })
  }

  const removeImport = (namespace: string) => {
    history.update((draft) => {
      if (!draft.imports) return
      delete draft.imports[namespace]
    })
  }

  const addImport = () => {
    const namespace = newNamespace.trim()
    const location = newLocation.trim() || `schemas/${namespace}.schema.json`
    if (!namespace) {
      setErrorToast('An import needs a namespace.')
      return
    }
    if (!/^[A-Za-z0-9._-]+$/.test(namespace)) {
      setErrorToast('Namespaces contain letters, numbers, dots, dashes, or underscores.')
      return
    }
    if (imports[namespace]) {
      setErrorToast(`"${namespace}" is already mapped.`)
      return
    }
    setLocation(namespace, location)
    setNewNamespace('')
    setNewLocation('')
    showToast(`Mapped ${namespace}`)
  }

  const mapDiscovered = (row: ProjectSchemaRow) => {
    const location = row.path ? row.path.replace(/^\/+/, '') : row.location
    setLocation(row.namespace, location)
    showToast(`Mapped ${row.namespace}`)
  }

  const openIssue = async (issue: ValidationIssue) => {
    const target = issueTarget(issue)
    if (!target) return
    try {
      await client.openFile(target)
    } catch (error) {
      showError(error)
    }
  }

  return (
    <div className="project-editor-shell">
      <header className="project-editor-toolbar">
        <div className="project-editor-identity">
          <div className="project-editor-mark" aria-hidden="true">T</div>
          <div>
            <strong>project.json</strong>
            <span>Tenon project</span>
          </div>
        </div>
        <div className={`project-editor-readiness ${analysis.ready ? 'ready' : 'blocked'}`}>
          <span className="project-editor-status-dot" />
          {analysis.ready ? 'Project resolves' : `${analysis.errors} blocking error${analysis.errors === 1 ? '' : 's'}`}
        </div>
      </header>

      {external && (
        <div className="project-editor-banner warning" role="status">
          <span>
            {external.kind === 'deleted'
              ? 'project.json was deleted outside this editor.'
              : 'project.json changed outside this editor.'}
            {dirty ? ' Your unsaved changes are kept.' : ''}
          </span>
          <button type="button" className="link-button" onClick={() => void reload(true)}>
            Reload
          </button>
          <button type="button" className="link-button" onClick={() => setExternal(null)}>
            Dismiss
          </button>
        </div>
      )}
      {toast && (
        <div className="project-editor-banner success" role="status">
          <span>{toast}</span>
          <button type="button" className="link-button" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
      {errorToast && (
        <div className="project-editor-banner danger" role="alert">
          <span>{errorToast}</span>
          <button type="button" className="link-button" onClick={() => setErrorToast(null)}>Dismiss</button>
        </div>
      )}

      <div className="project-editor-body">
        <section className="project-editor-panel">
          <div className="project-editor-panel-heading">
            <h2>Import map</h2>
            <span>{Object.keys(imports).length} mapped</span>
          </div>
          <p className="project-editor-hint">
            Namespaces resolve to builtin, project-relative, or HTTPS schema locations. The map is
            authoritative for builds. <code>basic3d</code> is implicit.
          </p>
          <div className="project-editor-imports">
            {Object.entries(imports).length === 0 ? (
              <p className="project-editor-empty">No imports mapped.</p>
            ) : (
              Object.entries(imports).map(([namespace, location]) => (
                <div className="project-editor-import-row" key={namespace}>
                  <code>{namespace}</code>
                  <input
                    type="text"
                    value={location}
                    disabled={!canWrite}
                    onChange={(event) => setLocation(namespace, event.target.value)}
                  />
                  <button
                    type="button"
                    className="button tiny ghost"
                    disabled={!canWrite}
                    onClick={() => removeImport(namespace)}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="project-editor-add-import">
            <input
              type="text"
              placeholder="namespace"
              value={newNamespace}
              disabled={!canWrite}
              onChange={(event) => setNewNamespace(event.target.value)}
            />
            <input
              type="text"
              placeholder="schemas/name.schema.json or https://…"
              value={newLocation}
              disabled={!canWrite}
              onChange={(event) => setNewLocation(event.target.value)}
            />
            <button
              type="button"
              className="button tiny primary"
              disabled={!canWrite}
              onClick={addImport}
            >
              Add import
            </button>
          </div>
          {unmapped.length > 0 && (
            <div className="project-editor-unmapped">
              <h3>Schemas found but not mapped</h3>
              <ul>
                {unmapped.map((row) => (
                  <li key={`${row.namespace}-${row.path}`}>
                    <span>
                      {row.namespace}@{row.version}
                      <small>{row.path}</small>
                    </span>
                    <button
                      type="button"
                      className="button tiny ghost"
                      disabled={!canWrite}
                      onClick={() => mapDiscovered(row)}
                    >
                      Map
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="project-editor-panel">
          <div className="project-editor-panel-heading">
            <h2>Resolved schemas</h2>
            <span>{analysis.schemas.length} namespaces</span>
          </div>
          <table className="project-editor-schema-table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Version</th>
                <th>Source</th>
                <th>Hash</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {analysis.schemas.map((row) => (
                <tr key={`${row.namespace}-${row.location}`} className={row.status}>
                  <td>
                    <code>{row.namespace}</code>
                  </td>
                  <td>{row.version || '—'}</td>
                  <td>
                    <span className={`project-editor-source ${row.source} ${row.status}`}>
                      {sourceLabel(row)}
                    </span>
                  </td>
                  <td>
                    <code>{row.hash ?? '—'}</code>
                  </td>
                  <td className="project-editor-location">{row.path ?? row.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="project-editor-build">
            <div>
              <h3>Build readiness</h3>
              <p>
                {analysis.ready
                  ? 'Schemas and scenes resolve. The build pipeline arrives in M4.'
                  : `${analysis.errors} error${analysis.errors === 1 ? '' : 's'} ${
                      analysis.errors === 1 ? 'blocks' : 'block'
                    } a build.`}
              </p>
            </div>
            <code>{command ?? 'Add a level under levels/ first.'}</code>
          </div>
        </section>

        <section className="project-editor-panel project-editor-validation">
          <div className="project-editor-panel-heading">
            <h2>Project validation</h2>
            <span>
              {analysis.errors} errors · {analysis.warnings} warnings
            </span>
          </div>
          {analysis.issues.length === 0 ? (
            <p className="project-editor-empty">No project issues.</p>
          ) : (
            <ul className="project-editor-issue-list">
              {analysis.issues.map((issue, index) => {
                const target = issueTarget(issue)
                return (
                  <li key={`${issue.code}-${index}`} className={issue.severity}>
                    <span className="project-editor-issue-dot" />
                    <div>
                      <div>
                        <code>{issue.code}</code>
                        <span>{issue.message}</span>
                      </div>
                      <div className="project-editor-issue-meta">
                        {target && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => void openIssue(issue)}
                          >
                            Open {target}
                          </button>
                        )}
                        {issue.scenePath && <span>{issue.scenePath}</span>}
                        {issue.sourcePath && issue.sourcePath !== issue.scenePath && (
                          <span>{issue.sourcePath}</span>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
