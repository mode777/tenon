import { useEffect, useMemo, useState } from 'react'
import type { ValidationIssue } from '../../core/schema'
import {
  directChildren,
  entityById,
  entityEvents,
  entityLabel,
  entityProperties,
  expandScene,
  sceneSurface,
  validateScene,
  type SceneDocument,
  type SceneValidationContext,
} from '../../core/scene'
import type { LoadedWorkspace } from '../../core/workspace'
import type { SceneCommand } from '../scene-commands'
import { fieldTypeLabel, schemaLabel } from '../scene-labels'
import type { InspectionTab } from '../scene-panel-protocol'

function issueTone(severity: ValidationIssue['severity']): string {
  return severity === 'error' ? 'error' : 'warning'
}

function ValidationList({
  issues,
  onSelect,
}: {
  issues: ValidationIssue[]
  onSelect: (entityId: string) => void
}) {
  if (issues.length === 0) {
    return <p className="scene-empty-note">No validation issues in this document.</p>
  }
  return (
    <ul className="scene-issue-list">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={`scene-issue ${issueTone(issue.severity)}`}>
          <span className="scene-issue-dot" aria-hidden="true" />
          <div className="scene-issue-copy">
            <div>
              <span className="scene-issue-code">{issue.code}</span>
              <span className="scene-issue-message">{issue.message}</span>
            </div>
            <div className="scene-issue-meta">
              {issue.entityId && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onSelect(issue.entityId!)}
                >
                  Select {issue.entityId}
                </button>
              )}
              {issue.scenePath && <span>{issue.scenePath}</span>}
              {issue.sourcePath && issue.sourcePath !== issue.scenePath && (
                <span>{issue.sourcePath}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export interface InspectionPanelProps {
  doc: SceneDocument
  path: string
  context: SceneValidationContext
  workspace: LoadedWorkspace
  canWrite: boolean
  focusTab: InspectionTab | null
  onFocusTabHandled: () => void
  onSelect: (entityId: string | null) => void
  onCommand: (command: SceneCommand) => void
}

export function InspectionPanel({
  doc,
  path,
  context,
  workspace,
  canWrite,
  focusTab,
  onFocusTabHandled,
  onSelect,
  onCommand,
}: InspectionPanelProps) {
  const [tab, setTab] = useState<InspectionTab>('validation')
  const [expanded, setExpanded] = useState(false)
  const [promotionName, setPromotionName] = useState('')
  const [promotionEntity, setPromotionEntity] = useState('')
  const [promotionKind, setPromotionKind] = useState<'field' | 'event'>('field')
  const [promotionTarget, setPromotionTarget] = useState('')
  const [slotName, setSlotName] = useState('')
  const [slotAnchor, setSlotAnchor] = useState('')

  useEffect(() => {
    if (!focusTab) return
    setTab(focusTab)
    onFocusTabHandled()
  }, [focusTab, onFocusTabHandled])

  const validation = useMemo(() => validateScene(doc, context, path), [context, doc, path])
  const allIssues = useMemo(
    () => [...workspace.issues, ...validation.issues],
    [validation.issues, workspace.issues],
  )
  const surface = useMemo(() => sceneSurface(doc, context), [context, doc])
  const directChildOptions = useMemo(() => directChildren(doc, doc.root), [doc])
  const effectivePromotionEntity = promotionEntity || directChildOptions[0]?.id || ''
  const promotionTargetEntity = effectivePromotionEntity
    ? entityById(doc, effectivePromotionEntity)
    : undefined
  const promotionTargetOptions = useMemo(() => {
    if (!promotionTargetEntity) return []
    if (promotionKind === 'event') {
      return entityEvents(doc, promotionTargetEntity, context).map((event) => event.name)
    }
    return entityProperties(doc, promotionTargetEntity, context).map((prop) => prop.name)
  }, [context, doc, promotionKind, promotionTargetEntity])
  const effectivePromotionTarget = promotionTargetOptions.includes(promotionTarget)
    ? promotionTarget
    : (promotionTargetOptions[0] ?? '')
  const effectiveSlotAnchor = slotAnchor || doc.entities[1]?.id || doc.root
  const expandedScene = useMemo(
    () => (expanded ? expandScene(doc, context, path) : null),
    [context, doc, expanded, path],
  )

  const addPromotionFromForm = () => {
    const name = promotionName.trim()
    if (!name || !effectivePromotionEntity || !effectivePromotionTarget) {
      return
    }
    onCommand({
      type: 'add-promotion',
      name,
      target: {
        entity: effectivePromotionEntity,
        ...(promotionKind === 'field'
          ? { field: effectivePromotionTarget }
          : { event: effectivePromotionTarget }),
      },
    })
    setPromotionName('')
  }

  const addSlotFromForm = () => {
    const name = slotName.trim()
    if (!name || !effectiveSlotAnchor) return
    onCommand({ type: 'add-slot', name, entity: effectiveSlotAnchor })
    setSlotName('')
  }

  return (
    <div className="scene-panel-surface scene-inspection-panel">
      <div className="scene-drawer-tabs">
        <button
          type="button"
          className={tab === 'validation' ? 'active' : ''}
          onClick={() => setTab('validation')}
        >
          Validation
          <span className="scene-pill">{allIssues.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'public' ? 'active' : ''}
          onClick={() => setTab('public')}
        >
          Public surface
          <span className="scene-pill">{surface.fields.length + surface.events.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'debug' ? 'active' : ''}
          onClick={() => {
            setTab('debug')
            setExpanded(true)
          }}
        >
          Debug expansion
        </button>
      </div>
      <div className="scene-drawer-body">
        {tab === 'validation' && (
          <ValidationList
            issues={allIssues}
            onSelect={(entityId) => onSelect(entityId)}
          />
        )}
        {tab === 'public' && (
          <div className="scene-public-grid">
            <section className="scene-public-surface">
              <h3>Effective public surface</h3>
              {surface.fields.length === 0 && surface.events.length === 0 ? (
                <p className="scene-empty-note">The scene has no public fields or events yet.</p>
              ) : (
                <ul className="scene-surface-list">
                  {surface.fields.map((field) => (
                    <li key={`field-${field.name}`}>
                      <span className="scene-surface-name">{field.name}</span>
                      <span className="scene-surface-type">{fieldTypeLabel(field.field)}</span>
                      <span className="scene-origin">{schemaLabel(field.originDefinitionId)}</span>
                      <span className={`scene-promoted ${field.promoted ? '' : 'root'}`}>
                        {field.promoted ? 'promoted' : 'root'}
                      </span>
                    </li>
                  ))}
                  {surface.events.map((event) => (
                    <li key={`event-${event.name}`}>
                      <span className="scene-surface-name">{event.name}</span>
                      <span className="scene-surface-type">event</span>
                      <span className="scene-origin">{schemaLabel(event.originDefinitionId)}</span>
                      <span className={`scene-promoted ${event.promoted ? '' : 'root'}`}>
                        {event.promoted ? 'promoted' : 'root'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {surface.issues.length > 0 && (
                <p className="scene-warning">{surface.issues.length} public-surface issue(s).</p>
              )}
            </section>

            <section className="scene-promotions">
              <h3>Promotions</h3>
              {Object.keys(doc.promotes ?? {}).length === 0 ? (
                <p className="scene-empty-note">No promotions.</p>
              ) : (
                <ul className="scene-public-list">
                  {Object.entries(doc.promotes ?? {}).map(([name, promotion]) => (
                    <li key={name}>
                      <span className="scene-public-name">{name}</span>
                      <span>
                        {promotion.entity}.{promotion.field ?? promotion.event}
                      </span>
                      <span className="scene-origin">{promotion.event ? 'event' : 'field'}</span>
                      <button
                        type="button"
                        className="link-button"
                        disabled={!canWrite}
                        onClick={() => onCommand({ type: 'remove-promotion', name })}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="scene-inline-form">
                <input
                  type="text"
                  aria-label="Promotion name"
                  placeholder="public name"
                  value={promotionName}
                  disabled={!canWrite}
                  onChange={(event) => setPromotionName(event.target.value)}
                />
                <select
                  aria-label="Promotion target entity"
                  value={effectivePromotionEntity}
                  disabled={!canWrite}
                  onChange={(event) => {
                    setPromotionEntity(event.target.value)
                    setPromotionTarget('')
                  }}
                >
                  {directChildOptions.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.id} · {entityLabel(entity)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Promotion kind"
                  value={promotionKind}
                  disabled={!canWrite}
                  onChange={(event) => {
                    setPromotionKind(event.target.value as 'field' | 'event')
                    setPromotionTarget('')
                  }}
                >
                  <option value="field">field</option>
                  <option value="event">event</option>
                </select>
                <select
                  aria-label="Promotion target"
                  value={effectivePromotionTarget}
                  disabled={!canWrite || promotionTargetOptions.length === 0}
                  onChange={(event) => setPromotionTarget(event.target.value)}
                >
                  {promotionTargetOptions.length === 0 && <option value="">—</option>}
                  {promotionTargetOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button tiny primary"
                  disabled={
                    !canWrite ||
                    !promotionName.trim() ||
                    !effectivePromotionEntity ||
                    !effectivePromotionTarget
                  }
                  onClick={addPromotionFromForm}
                >
                  Promote
                </button>
              </div>
              {directChildOptions.length === 0 && (
                <p className="scene-hint">
                  Promotions can target direct children of the root only.
                </p>
              )}
            </section>

            <section className="scene-slots">
              <h3>Slots</h3>
              {Object.keys(doc.slots ?? {}).length === 0 ? (
                <p className="scene-empty-note">No slots.</p>
              ) : (
                <ul className="scene-public-list">
                  {Object.entries(doc.slots ?? {}).map(([name, slot]) => (
                    <li key={name}>
                      <span className="scene-public-name">{name}</span>
                      <span>{slot.entity}</span>
                      <span className="scene-origin">anchor</span>
                      <button
                        type="button"
                        className="link-button"
                        disabled={!canWrite}
                        onClick={() => onCommand({ type: 'remove-slot', name })}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="scene-inline-form">
                <input
                  type="text"
                  aria-label="Slot name"
                  placeholder="slot name"
                  value={slotName}
                  disabled={!canWrite}
                  onChange={(event) => setSlotName(event.target.value)}
                />
                <select
                  aria-label="Slot anchor"
                  value={effectiveSlotAnchor}
                  disabled={!canWrite}
                  onChange={(event) => setSlotAnchor(event.target.value)}
                >
                  {doc.entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.id} · {entityLabel(entity)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button tiny primary"
                  disabled={!canWrite || !slotName.trim() || !effectiveSlotAnchor}
                  onClick={addSlotFromForm}
                >
                  Add slot
                </button>
              </div>
            </section>
          </div>
        )}
        {tab === 'debug' && (
          <div className="scene-debug">
            <div className="scene-debug-heading">
              <span>
                {expandedScene
                  ? `${expandedScene.entities.length} resolved entities · ${expandedScene.issues.length} expansion issues`
                  : 'Expansion has not run.'}
              </span>
              <button
                type="button"
                className="button tiny ghost"
                onClick={() => setExpanded(true)}
              >
                Resolve scene instances
              </button>
            </div>
            {expandedScene && expandedScene.issues.length > 0 && (
              <ValidationList
                issues={expandedScene.issues}
                onSelect={(entityId) => onSelect(entityId)}
              />
            )}
            {expandedScene && (
              <pre className="scene-debug-json">
                {JSON.stringify(expandedScene.entities, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
