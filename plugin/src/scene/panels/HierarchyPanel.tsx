import { useEffect, useMemo, useState } from 'react'
import type { ValidationIssue } from '../../core/schema'
import {
  directChildren,
  displayScenePath,
  entityById,
  entityIsSceneInstance,
  entityLabel,
  sceneFileName,
  validateScene,
  type SceneDocument,
  type SceneValidationContext,
} from '../../core/scene'
import type { LoadedWorkspace } from '../../core/workspace'
import type { SceneCommand } from '../scene-commands'
import type { SceneEditorIntent } from '../scene-panel-protocol'
import { concreteDefinitions, sceneOptions } from '../scene-workspace'

type SidebarTab = 'entities' | 'scenes' | 'assets'

export interface HierarchyPanelProps {
  doc: SceneDocument
  path: string
  selection: string | null
  context: SceneValidationContext
  workspace: LoadedWorkspace
  canWrite: boolean
  refreshing: boolean
  onRefresh: () => void
  onCommand: (command: SceneCommand) => void
  onIntent: (intent: SceneEditorIntent) => void
}

export function HierarchyPanel({
  doc,
  path,
  selection,
  context,
  workspace,
  canWrite,
  refreshing,
  onRefresh,
  onCommand,
  onIntent,
}: HierarchyPanelProps) {
  const [tab, setTab] = useState<SidebarTab>('entities')
  const [search, setSearch] = useState('')
  const [sceneSearch, setSceneSearch] = useState('')
  const [assetSearch, setAssetSearch] = useState('')

  const validation = useMemo(() => validateScene(doc, context, path), [context, doc, path])
  const paletteDefinitions = useMemo(() => concreteDefinitions(context), [context])
  const instanceScenes = useMemo(() => sceneOptions(workspace, path), [path, workspace])
  const selectedEntity = selection ? entityById(doc, selection) : undefined
  const creationParentId =
    selectedEntity && selectedEntity.id !== doc.root && !entityIsSceneInstance(selectedEntity)
      ? selectedEntity.id
      : doc.root

  const filteredDefinitions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return paletteDefinitions
    return paletteDefinitions.filter(
      (definition) =>
        definition.type.toLowerCase().includes(query) ||
        (definition.doc ?? '').toLowerCase().includes(query),
    )
  }, [paletteDefinitions, search])
  const filteredScenes = useMemo(() => {
    const query = sceneSearch.trim().toLowerCase()
    if (!query) return instanceScenes
    return instanceScenes.filter((scene) => scene.path.toLowerCase().includes(query))
  }, [instanceScenes, sceneSearch])
  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase()
    const assets = workspace.assets
    if (!query) return assets
    return assets.filter((asset) => asset.toLowerCase().includes(query))
  }, [assetSearch, workspace.assets])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onIntent({ type: 'save' })
        return
      }
      if (editing) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        onIntent({ type: event.shiftKey ? 'redo' : 'undo' })
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        onIntent({ type: 'redo' })
        return
      }
      if (!canWrite) return
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 'd' && selectedEntity && selectedEntity.id !== doc.root) {
          event.preventDefault()
          onCommand({ type: 'duplicate-entity', entityId: selectedEntity.id })
        }
        return
      }
      if (event.key.toLowerCase() === 'w') onIntent({ type: 'set-mode', mode: 'translate' })
      if (event.key.toLowerCase() === 'e') onIntent({ type: 'set-mode', mode: 'rotate' })
      if (event.key.toLowerCase() === 'r') onIntent({ type: 'set-mode', mode: 'scale' })
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedEntity && selectedEntity.id !== doc.root) {
          event.preventDefault()
          onCommand({ type: 'delete-entity', entityId: selectedEntity.id })
        }
      }
      if (event.key === 'Escape') {
        onCommand({ type: 'select', entityId: null })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canWrite, doc, onCommand, onIntent, selectedEntity])

  const addDefinition = (type: string) =>
    onCommand({ type: 'add-entity', definition: type, parentId: creationParentId })
  const addInstance = (scenePath: string) =>
    onCommand({ type: 'add-scene-instance', scenePath, parentId: creationParentId })
  const addAsset = (asset: string) =>
    onCommand({ type: 'add-asset', asset, parentId: creationParentId })

  return (
    <div className="scene-panel-surface scene-hierarchy-frame">
      <section className="scene-panel scene-hierarchy-panel">
        <div className="scene-panel-heading">
          <h2>Hierarchy</h2>
          <span>{doc.entities.length}</span>
        </div>
        <div className="scene-tree" role="tree" aria-label="Scene hierarchy">
          <HierarchyTree
            scene={doc}
            entityId={doc.root}
            selection={selection}
            issues={validation.issues}
            onSelect={(entityId) => onCommand({ type: 'select', entityId })}
          />
          {!entityById(doc, doc.root) && (
            <p className="scene-empty-note">The root entity is missing.</p>
          )}
        </div>
      </section>

      <section className="scene-panel scene-library-panel">
        <div className="scene-panel-tabs">
          <button
            type="button"
            className={tab === 'entities' ? 'active' : ''}
            onClick={() => setTab('entities')}
          >
            Entities
          </button>
          <button
            type="button"
            className={tab === 'scenes' ? 'active' : ''}
            onClick={() => setTab('scenes')}
          >
            Scenes
          </button>
          <button
            type="button"
            className={tab === 'assets' ? 'active' : ''}
            onClick={() => setTab('assets')}
          >
            Assets
          </button>
        </div>

        {tab === 'entities' && (
          <div className="scene-library-body">
            <div className="scene-library-tools">
              <input
                type="search"
                className="scene-search"
                placeholder="Search definitions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                type="button"
                className="button tiny ghost scene-refresh"
                title="Refresh schemas and entities"
                aria-label="Refresh schemas and entities"
                disabled={refreshing}
                onClick={onRefresh}
              >
                {refreshing ? '…' : '↻'}
              </button>
            </div>
            {filteredDefinitions.length === 0 ? (
              <p className="scene-empty-note">
                No concrete definitions. Add one in a schema bundle required by this scene.
              </p>
            ) : (
              <ul className="scene-palette-list">
                {filteredDefinitions.map((definition) => (
                  <li key={definition.type}>
                    <button
                      type="button"
                      className="scene-palette-item"
                      disabled={!canWrite}
                      onClick={() => addDefinition(definition.type)}
                      title={definition.doc}
                    >
                      <span>{definition.type}</span>
                      <small>{definition.namespace}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'scenes' && (
          <div className="scene-library-body">
            <div className="scene-library-tools">
              <input
                type="search"
                className="scene-search"
                placeholder="Search scenes"
                value={sceneSearch}
                onChange={(event) => setSceneSearch(event.target.value)}
              />
              <button
                type="button"
                className="button tiny ghost scene-refresh"
                title="Refresh scene documents"
                aria-label="Refresh scene documents"
                disabled={refreshing}
                onClick={onRefresh}
              >
                {refreshing ? '…' : '↻'}
              </button>
            </div>
            {filteredScenes.length === 0 ? (
              <p className="scene-empty-note">No other scene documents.</p>
            ) : (
              <ul className="scene-palette-list">
                {filteredScenes.map((scene) => (
                  <li key={scene.path}>
                    <button
                      type="button"
                      className="scene-palette-item"
                      disabled={!canWrite}
                      onClick={() => addInstance(scene.path)}
                    >
                      <span>{sceneFileName(scene.path)}</span>
                      <small>{scene.path}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'assets' && (
          <div className="scene-library-body">
            <div className="scene-library-tools">
              <input
                type="search"
                className="scene-search"
                placeholder="Search assets"
                value={assetSearch}
                onChange={(event) => setAssetSearch(event.target.value)}
              />
              <button
                type="button"
                className="button tiny ghost scene-refresh"
                title="Refresh assets"
                aria-label="Refresh assets"
                disabled={refreshing}
                onClick={onRefresh}
              >
                {refreshing ? '…' : '↻'}
              </button>
            </div>
            {!workspace.assetsKnown && (
              <p className="scene-empty-note">
                Directory listing is unavailable in this shell. Asset paths can still be typed.
              </p>
            )}
            {filteredAssets.length === 0 ? (
              <p className="scene-empty-note">
                No assets under <code>/assets</code>.
              </p>
            ) : (
              <ul className="scene-asset-list">
                {filteredAssets.map((asset) => (
                  <li key={asset}>
                    <span className="scene-asset-name">{displayScenePath(asset)}</span>
                    <button
                      type="button"
                      className="button tiny ghost"
                      disabled={!canWrite || !asset.toLowerCase().endsWith('.glb')}
                      onClick={() => addAsset(asset)}
                    >
                      Place
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function HierarchyTree({
  scene,
  entityId,
  selection,
  issues,
  onSelect,
  path = [],
}: {
  scene: SceneDocument
  entityId: string
  selection: string | null
  issues: ValidationIssue[]
  onSelect: (id: string) => void
  path?: string[]
}) {
  if (path.includes(entityId)) return null
  const entity = entityById(scene, entityId)
  if (!entity) return null
  const children = directChildren(scene, entity.id).filter((child) => child.id !== entity.id)
  const entityIssues = issues.filter((issue) => issue.entityId === entity.id)
  return (
    <div className="scene-tree-node" role="treeitem" aria-selected={selection === entity.id}>
      <button
        type="button"
        className={`scene-tree-row ${selection === entity.id ? 'selected' : ''}`}
        onClick={() => onSelect(entity.id)}
      >
        <span className={`scene-tree-icon ${entity.scene ? 'instance' : ''}`}>
          {entity.scene ? '◇' : entity.type?.split(':').at(-1) === 'node' ? '○' : '◆'}
        </span>
        <span className="scene-tree-label">{entityLabel(entity)}</span>
        <code>{entity.id}</code>
        {entityIssues.length > 0 && (
          <span
            className={`scene-tree-dot ${
              entityIssues.some((issue) => issue.severity === 'error') ? 'error' : 'warning'
            }`}
            title={entityIssues.map((issue) => issue.message).join('\n')}
          />
        )}
      </button>
      {children.length > 0 && (
        <div className="scene-tree-children">
          {children.map((child) => (
            <HierarchyTree
              key={child.id}
              scene={scene}
              entityId={child.id}
              selection={selection}
              issues={issues}
              onSelect={onSelect}
              path={[...path, entity.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
