import type { EditorClient, FileChangedPayload } from '@exo/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFERRED_FIELD_TYPES,
  MVP_FIELD_TYPES,
  TYPE_LABELS,
  addDefinition,
  allDefinitionIds,
  builtinBundle,
  cloneJson,
  defaultPreview,
  definitionLocalName,
  definitionNamespace,
  deleteDefinitionInBundle,
  deleteEnumInBundle,
  effectiveDefinition,
  enumUsageCount,
  fieldHasDefault,
  isBuiltinDefinition,
  lookupDefinition,
  parseSchemaText,
  qualify,
  renameDefinitionInBundle,
  renameEnumInBundle,
  renameEnumValueInBundle,
  schemaToText,
  uniqueLocalName,
  usageCount,
  validateSchema,
  wouldCreateCycle,
  type EffectiveDefinition,
  type EffectiveEvent,
  type EffectiveField,
  type SchemaBundle,
  type SchemaDefinition,
  type SchemaEnum,
  type SchemaEvent,
  type SchemaField,
  type ValidationIssue,
} from '../core/schema'
import { FieldEditor } from './FieldEditor'
import { CommitInput } from './Inputs'

type Selection =
  | { kind: 'definition'; id: string }
  | { kind: 'enum'; name: string }
  | null

type DetailTab = 'fields' | 'events' | 'effective'

interface SchemaEditorProps {
  client: EditorClient
  initialDoc: SchemaBundle
  canWrite: boolean
}

interface HistoryState {
  doc: SchemaBundle
  past: SchemaBundle[]
  future: SchemaBundle[]
}

interface Toast {
  kind: 'notice' | 'error'
  message: string
}

const HISTORY_LIMIT = 100

function initialSelection(doc: SchemaBundle, builtin: SchemaBundle): Selection {
  const own = Object.keys(doc.definitions).sort((a, b) => a.localeCompare(b))[0]
  if (own) return { kind: 'definition', id: own }
  const built = Object.keys(builtin.definitions).sort((a, b) => a.localeCompare(b))[0]
  return built ? { kind: 'definition', id: built } : null
}

function reorderRecord<T>(record: Record<string, T>, key: string, direction: -1 | 1): Record<string, T> {
  const entries = Object.entries(record)
  const index = entries.findIndex(([name]) => name === key)
  if (index < 0) return record
  const target = index + direction
  if (target < 0 || target >= entries.length) return record
  const next = [...entries]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return Object.fromEntries(next)
}

function issuesFor(
  issues: ValidationIssue[],
  definitionId: string,
  fieldName?: string,
  eventName?: string,
): ValidationIssue[] {
  return issues.filter((issue) => {
    if (issue.definitionId !== definitionId) return false
    if (fieldName !== undefined) {
      if (issue.fieldName !== fieldName) return false
      if (eventName === undefined && issue.eventName !== undefined) return false
    }
    if (eventName !== undefined && issue.eventName !== eventName) return false
    if (fieldName === undefined && eventName === undefined) {
      if (issue.fieldName !== undefined || issue.eventName !== undefined) return false
    }
    return true
  })
}

function fieldByOrigin(effective: EffectiveDefinition, name: string): EffectiveField | undefined {
  return effective.fields.find((field) => field.name === name)
}

function eventByOrigin(effective: EffectiveDefinition, name: string): EffectiveEvent | undefined {
  return effective.events.find((event) => event.name === name)
}

function useHistory(initial: SchemaBundle) {
  const [state, setState] = useState<HistoryState>({ doc: initial, past: [], future: [] })

  const update = (recipe: (doc: SchemaBundle) => void) => {
    setState((previous) => {
      const next = cloneJson(previous.doc)
      recipe(next)
      return {
        doc: next,
        past: [...previous.past, previous.doc].slice(-HISTORY_LIMIT),
        future: [],
      }
    })
  }

  const reset = (doc: SchemaBundle) => {
    setState({ doc, past: [], future: [] })
  }

  const replace = (doc: SchemaBundle) => {
    setState((previous) => ({
      doc,
      past: [...previous.past, previous.doc].slice(-HISTORY_LIMIT),
      future: [],
    }))
  }

  const undo = () => {
    setState((previous) => {
      const previousDoc = previous.past.at(-1)
      if (!previousDoc) return previous
      return {
        doc: previousDoc,
        past: previous.past.slice(0, -1),
        future: [previous.doc, ...previous.future].slice(0, HISTORY_LIMIT),
      }
    })
  }

  const redo = () => {
    setState((previous) => {
      const nextDoc = previous.future[0]
      if (!nextDoc) return previous
      return {
        doc: nextDoc,
        past: [...previous.past, previous.doc].slice(-HISTORY_LIMIT),
        future: previous.future.slice(1),
      }
    })
  }

  return { state, update, reset, replace, undo, redo }
}

function toastClass(kind: Toast['kind']): string {
  return kind === 'error' ? 'banner danger' : 'banner success'
}

export function SchemaEditor({ client, initialDoc, canWrite }: SchemaEditorProps) {
  const builtin = useMemo(() => builtinBundle(), [])
  const { state, update, reset, replace, undo, redo } = useHistory(initialDoc)
  const [savedText, setSavedText] = useState(() => schemaToText(initialDoc))
  const [selection, setSelection] = useState<Selection>(() => initialSelection(initialDoc, builtin))
  const [tab, setTab] = useState<DetailTab>('fields')
  const [selectedFieldName, setSelectedFieldName] = useState<string | null>(null)
  const [selectedEventName, setSelectedEventName] = useState<string | null>(null)
  const [selectedPayloadFieldName, setSelectedPayloadFieldName] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [newDefinitionName, setNewDefinitionName] = useState<string | null>(null)
  const [newFieldName, setNewFieldName] = useState<string | null>(null)
  const [newFieldType, setNewFieldType] = useState('string')
  const [newEventName, setNewEventName] = useState<string | null>(null)
  const [newPayloadName, setNewPayloadName] = useState<string | null>(null)
  const [newPayloadType, setNewPayloadType] = useState('string')
  const [newEnumName, setNewEnumName] = useState<string | null>(null)
  const [newEnumValue, setNewEnumValue] = useState<string | null>(null)
  const [validationOpen, setValidationOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [external, setExternal] = useState<FileChangedPayload | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pathRef = useRef(client.file.path)
  const pendingSaveRef = useRef<string | null>(null)
  const docRef = useRef(state.doc)
  const dirtyRef = useRef(false)

  const serialized = schemaToText(state.doc)
  const dirty = serialized !== savedText
  docRef.current = state.doc
  dirtyRef.current = dirty

  const validation = useMemo(() => validateSchema(state.doc, builtin), [state.doc, builtin])
  const selectedDefinitionId = selection?.kind === 'definition' ? selection.id : null
  const selectedEnumName = selection?.kind === 'enum' ? selection.name : null
  const selectedLookup = selectedDefinitionId
    ? lookupDefinition(selectedDefinitionId, state.doc, builtin)
    : null
  const selectedDefinition = selectedLookup?.definition ?? null
  const selectedIsBuiltin = selectedDefinitionId
    ? isBuiltinDefinition(selectedDefinitionId, state.doc, builtin)
    : false
  const selectedEffective = useMemo(
    () => (selectedDefinitionId ? effectiveDefinition(selectedDefinitionId, state.doc, builtin) : null),
    [selectedDefinitionId, state.doc, builtin],
  )
  const selectedEnum = selectedEnumName ? state.doc.enums?.[selectedEnumName] : undefined
  const editable = canWrite && Boolean(selectedDefinitionId) && !selectedIsBuiltin

  useEffect(() => {
    if (!selection) return
    if (selection.kind === 'definition') {
      if (!lookupDefinition(selection.id, state.doc, builtin)) {
        setSelection(initialSelection(state.doc, builtin))
        setSelectedFieldName(null)
        setSelectedEventName(null)
        setSelectedPayloadFieldName(null)
      }
      return
    }
    if (!state.doc.enums?.[selection.name]) {
      setSelection(initialSelection(state.doc, builtin))
    }
  }, [state.doc, selection, builtin])

  useEffect(() => {
    client.setDirty(dirty)
  }, [client, dirty])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const showError = (error: unknown) => {
    setToast({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  const showNotice = (message: string) => {
    setToast({ kind: 'notice', message })
  }

  const reloadFromDisk = async (force: boolean) => {
    if (!force && dirtyRef.current) {
      setExternal({ kind: 'changed', path: pathRef.current })
      return
    }
    try {
      const text = await client.readFile(pathRef.current, 'utf8')
      const next = parseSchemaText(text.text)
      reset(next)
      setSavedText(schemaToText(next))
      setSelection(initialSelection(next, builtin))
      setSelectedFieldName(null)
      setSelectedEventName(null)
      setSelectedPayloadFieldName(null)
      setExternal(null)
      showNotice('Reloaded from disk')
    } catch (error) {
      showError(error)
    }
  }

  useEffect(() => {
    const offSave = client.onSaveRequest(() => {
      const text = schemaToText(docRef.current)
      pendingSaveRef.current = text
      return { text }
    })
    const offResult = client.onSaveResult((result) => {
      if (result.ok) {
        setSavedText(pendingSaveRef.current ?? schemaToText(docRef.current))
        pendingSaveRef.current = null
        setToast({ kind: 'notice', message: 'Saved' })
      } else {
        setToast({
          kind: 'error',
          message: `${result.code}: ${result.message ?? 'The shell could not save the schema.'}`,
        })
      }
    })
    const offChanged = client.onFileChanged((change) => {
      if (change.kind === 'renamed') pathRef.current = change.path
      if (change.kind === 'deleted') {
        setExternal(change)
        return
      }
      if (dirtyRef.current) {
        setExternal(change)
        return
      }
      void reloadFromDisk(false)
    })
    const offError = client.onError((error) => {
      setToast({ kind: 'error', message: `${error.code}: ${error.message ?? 'Shell error'}` })
    })
    const offDispose = client.onDispose(() => {
      // The SDK sends the dispose acknowledgement; the frame is going away.
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
        client.requestSave()
        return
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (editing) return
      if (event.key === '?') {
        event.preventDefault()
        setHelpOpen((value) => !value)
        return
      }
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Escape') {
        setHelpOpen(false)
        setValidationOpen(false)
        setNewDefinitionName(null)
        setNewFieldName(null)
        setNewEventName(null)
        setNewPayloadName(null)
        setNewEnumName(null)
        setNewEnumValue(null)
        return
      }
      if (!canWrite) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setNewDefinitionName(uniqueLocalName(state.doc))
      }
      if (event.key.toLowerCase() === 'f' && selectedDefinitionId) {
        event.preventDefault()
        setTab('fields')
        setNewFieldName('')
      }
      if (event.key.toLowerCase() === 'e' && selectedDefinitionId) {
        event.preventDefault()
        if (event.shiftKey) {
          setNewEnumName('')
        } else {
          setTab('events')
          setNewEventName('')
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canWrite, selectedDefinitionId, state.doc, client, redo, undo])

  const selectDefinition = (id: string) => {
    setSelection({ kind: 'definition', id })
    setSelectedFieldName(null)
    setSelectedEventName(null)
    setSelectedPayloadFieldName(null)
  }

  const selectEnum = (name: string) => {
    setSelection({ kind: 'enum', name })
    setSelectedFieldName(null)
    setSelectedEventName(null)
    setSelectedPayloadFieldName(null)
  }

  const updateDefinition = (id: string, recipe: (definition: SchemaDefinition) => void) => {
    update((doc) => {
      const definition = doc.definitions[id]
      if (!definition) throw new Error(`Definition "${id}" no longer exists.`)
      recipe(definition)
    })
  }

  const renameSelectedDefinition = (localName: string) => {
    if (!selectedDefinitionId || !editable) return
    const clean = localName.trim()
    if (!clean) {
      showError('Definition name cannot be empty.')
      return
    }
    const nextId = qualify(state.doc.namespace, clean)
    if (nextId === selectedDefinitionId) return
    try {
      const next = renameDefinitionInBundle(state.doc, selectedDefinitionId, nextId)
      replace(next)
      setSelection({ kind: 'definition', id: nextId })
    } catch (error) {
      showError(error)
    }
  }

  const deleteSelectedDefinition = () => {
    if (!selectedDefinitionId || !editable) return
    const uses = usageCount(state.doc, selectedDefinitionId)
    const message = uses > 0
      ? `Delete "${selectedDefinitionId}"? ${uses} composition reference(s) in this bundle will be removed.`
      : `Delete "${selectedDefinitionId}"?`
    if (!window.confirm(message)) return
    const next = deleteDefinitionInBundle(state.doc, selectedDefinitionId)
    replace(next)
    setSelection(initialSelection(next, builtin))
    setSelectedFieldName(null)
    setSelectedEventName(null)
    setSelectedPayloadFieldName(null)
  }

  const toggleAbstract = () => {
    if (!selectedDefinitionId || !selectedDefinition || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      if (definition.abstract) delete definition.abstract
      else definition.abstract = true
    })
  }

  const addComposition = (target: string) => {
    if (!selectedDefinitionId || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      const compose = Array.isArray(definition.compose) ? definition.compose : []
      if (compose.includes(target)) return
      definition.compose = [...compose, target]
    })
  }

  const removeComposition = (target: string) => {
    if (!selectedDefinitionId || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      if (!Array.isArray(definition.compose)) return
      definition.compose = definition.compose.filter((item) => item !== target)
      if (definition.compose.length === 0) delete definition.compose
    })
  }

  const addField = () => {
    if (!selectedDefinitionId || !editable || newFieldName === null) return
    const name = newFieldName.trim()
    if (!name) {
      showError('Field name cannot be empty.')
      return
    }
    if (selectedEffective?.fields.some((field) => field.name === name)) {
      showError(`Field "${name}" already exists on the effective definition.`)
      return
    }
    try {
      updateDefinition(selectedDefinitionId, (definition) => {
        definition.fields = definition.fields ?? {}
        const field: SchemaField = { type: newFieldType }
        if (newFieldType === 'enum') {
          const firstEnum = Object.keys(state.doc.enums ?? {}).sort((a, b) => a.localeCompare(b))[0]
          if (firstEnum) field.enum = firstEnum
        }
        definition.fields[name] = field
      })
      setSelectedFieldName(name)
      setNewFieldName('')
      setTab('fields')
    } catch (error) {
      showError(error)
    }
  }

  const addEvent = () => {
    if (!selectedDefinitionId || !editable || newEventName === null) return
    const name = newEventName.trim()
    if (!name) {
      showError('Event name cannot be empty.')
      return
    }
    if (selectedEffective?.events.some((event) => event.name === name)) {
      showError(`Event "${name}" already exists on the effective definition.`)
      return
    }
    updateDefinition(selectedDefinitionId, (definition) => {
      definition.events = definition.events ?? {}
      definition.events[name] = {}
    })
    setSelectedEventName(name)
    setSelectedPayloadFieldName(null)
    setNewEventName('')
    setTab('events')
  }

  const addPayloadField = () => {
    if (!selectedDefinitionId || !selectedEventName || !editable || newPayloadName === null) return
    const name = newPayloadName.trim()
    if (!name) {
      showError('Payload field name cannot be empty.')
      return
    }
    const event = selectedDefinition?.events?.[selectedEventName]
    if (!event) return
    if (event.payload?.[name]) {
      showError(`Payload field "${name}" already exists.`)
      return
    }
    updateDefinition(selectedDefinitionId, (definition) => {
      const target = definition.events?.[selectedEventName]
      if (!target) return
      target.payload = target.payload ?? {}
      const field: SchemaField = { type: newPayloadType }
      if (newPayloadType === 'enum') {
        const firstEnum = Object.keys(state.doc.enums ?? {}).sort((a, b) => a.localeCompare(b))[0]
        if (firstEnum) field.enum = firstEnum
      }
      target.payload[name] = field
    })
    setSelectedPayloadFieldName(name)
    setNewPayloadName('')
  }

  const addEnum = () => {
    if (newEnumName === null || !canWrite) return
    const name = newEnumName.trim()
    if (!name) {
      showError('Enum name cannot be empty.')
      return
    }
    if (state.doc.enums?.[name]) {
      showError(`Enum "${name}" already exists.`)
      return
    }
    update((doc) => {
      doc.enums = doc.enums ?? {}
      doc.enums[name] = { values: [] }
    })
    selectEnum(name)
    setNewEnumName('')
  }

  const addFieldToPath = (path: { definitionId: string; eventName?: string; name: string; type: string }) => {
    if (!canWrite) return
    updateDefinition(path.definitionId, (definition) => {
      const field: SchemaField = { type: path.type }
      if (path.type === 'enum') {
        const firstEnum = Object.keys(state.doc.enums ?? {}).sort((a, b) => a.localeCompare(b))[0]
        if (firstEnum) field.enum = firstEnum
      }
      if (path.eventName) {
        const event = definition.events?.[path.eventName]
        if (!event) return
        event.payload = event.payload ?? {}
        event.payload[path.name] = field
      } else {
        definition.fields = definition.fields ?? {}
        definition.fields[path.name] = field
      }
    })
  }

  const selectedFieldEffective = selectedFieldName && selectedEffective
    ? fieldByOrigin(selectedEffective, selectedFieldName)
    : undefined
  const selectedEventEffective = selectedEventName && selectedEffective
    ? eventByOrigin(selectedEffective, selectedEventName)
    : undefined
  const selectedPayloadField = selectedEventName && selectedPayloadFieldName && selectedDefinition
    ? selectedDefinition.events?.[selectedEventName]?.payload?.[selectedPayloadFieldName]
    : undefined

  const fieldIssues = selectedDefinitionId && selectedFieldName
    ? issuesFor(validation.issues, selectedDefinitionId, selectedFieldName)
    : []
  const eventIssues = selectedDefinitionId && selectedEventName
    ? issuesFor(validation.issues, selectedDefinitionId, undefined, selectedEventName)
    : []
  const definitionIssues = selectedDefinitionId
    ? validation.issues.filter(
        (issue) => issue.definitionId === selectedDefinitionId && !issue.fieldName && !issue.eventName,
      )
    : []
  const enumIssues = selectedEnumName
    ? validation.issues.filter((issue) => issue.enumName === selectedEnumName)
    : []

  const openIssue = (issue: ValidationIssue) => {
    if (issue.enumName) {
      selectEnum(issue.enumName)
      setValidationOpen(false)
      return
    }
    if (issue.definitionId) {
      setSelection({ kind: 'definition', id: issue.definitionId })
      if (issue.fieldName || issue.eventName) {
        setTab(issue.eventName ? 'events' : 'fields')
        setSelectedFieldName(issue.fieldName ?? null)
        setSelectedEventName(issue.eventName ?? null)
        setSelectedPayloadFieldName(null)
      } else {
        setSelectedFieldName(null)
        setSelectedEventName(null)
        setSelectedPayloadFieldName(null)
      }
      setValidationOpen(false)
    }
  }

  const definitionEntries = useMemo(() => {
    const query = search.trim().toLowerCase()
    return Object.entries(state.doc.definitions)
      .filter(([id]) => {
        if (!query) return true
        if (id.toLowerCase().includes(query)) return true
        return Object.keys(state.doc.definitions[id].fields ?? {}).some((field) =>
          field.toLowerCase().includes(query),
        )
      })
      .sort(([a], [b]) => a.localeCompare(b))
  }, [state.doc, search])

  const builtinEntries = useMemo(() => {
    const query = search.trim().toLowerCase()
    return Object.entries(builtin.definitions)
      .filter(([id]) => !query || id.toLowerCase().includes(query))
      .sort(([a], [b]) => a.localeCompare(b))
  }, [builtin, search])

  const abstractEntries = definitionEntries.filter(([, definition]) => definition.abstract)
  const concreteEntries = definitionEntries.filter(([, definition]) => !definition.abstract)
  const enumNames = Object.keys(state.doc.enums ?? {}).sort((a, b) => a.localeCompare(b))
  const definitionCount = Object.keys(state.doc.definitions).length
  const currentDirtyLabel = dirty ? 'Unsaved changes' : 'Up to date'

  const updateSelectedField = (patch: Partial<SchemaField>) => {
    if (!selectedDefinitionId || !selectedFieldName || !editable) return
    const current = selectedFieldEffective
    if (!current) return
    if (current.inherited) {
      if (!selectedDefinition) return
      updateDefinition(selectedDefinitionId, (definition) => {
        definition.fields = definition.fields ?? {}
        definition.fields[selectedFieldName] = {
          ...current.field,
          ...patch,
          type: current.field.type,
        }
      })
      return
    }
    updateDefinition(selectedDefinitionId, (definition) => {
      const field = definition.fields?.[selectedFieldName]
      if (!field) return
      Object.assign(field, patch)
    })
  }

  const clearSelectedFieldDefault = () => {
    if (!selectedDefinitionId || !selectedFieldName || !editable) return
    const current = selectedFieldEffective
    if (!current) return
    updateDefinition(selectedDefinitionId, (definition) => {
      if (current.inherited) {
        definition.fields = definition.fields ?? {}
        const override = { ...current.field, type: current.field.type }
        delete override.default
        definition.fields[selectedFieldName] = override
      } else {
        const field = definition.fields?.[selectedFieldName]
        if (field) delete field.default
      }
    })
  }

  const renameField = (name: string) => {
    if (!selectedDefinitionId || !selectedFieldName || !editable) return
    const clean = name.trim()
    if (!clean || clean === selectedFieldName) return
    if (selectedFieldEffective?.inherited) {
      showError('Inherited field names are fixed; edit the source definition.')
      return
    }
    if (selectedEffective?.fields.some((field) => field.name === clean)) {
      showError(`Field "${clean}" already exists on the effective definition.`)
      return
    }
    updateDefinition(selectedDefinitionId, (definition) => {
      if (!definition.fields?.[selectedFieldName]) return
      definition.fields = Object.fromEntries(
        Object.entries(definition.fields).map(([key, value]) => [
          key === selectedFieldName ? clean : key,
          value,
        ]),
      )
    })
    setSelectedFieldName(clean)
  }

  const changeFieldType = (type: string) => {
    if (!selectedDefinitionId || !selectedFieldName || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      const field = definition.fields?.[selectedFieldName]
      if (!field) return
      field.type = type
      if (type === 'enum') {
        const firstEnum = Object.keys(state.doc.enums ?? {}).sort((a, b) => a.localeCompare(b))[0]
        if (firstEnum) field.enum = firstEnum
      } else {
        delete field.enum
      }
      delete field.default
    })
  }

  const deleteField = (name: string) => {
    if (!selectedDefinitionId || !name || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      if (definition.fields) delete definition.fields[name]
    })
    if (selectedFieldName === name) setSelectedFieldName(null)
  }

  const removeOverride = () => {
    if (!selectedDefinitionId || !selectedFieldName || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      if (definition.fields) delete definition.fields[selectedFieldName]
    })
  }

  const moveField = (direction: -1 | 1) => {
    if (!selectedDefinitionId || !selectedFieldName || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      if (!definition.fields) return
      definition.fields = reorderRecord(definition.fields, selectedFieldName, direction)
    })
  }

  const updateSelectedPayloadField = (patch: Partial<SchemaField>) => {
    if (!selectedDefinitionId || !selectedEventName || !selectedPayloadFieldName || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      const field = definition.events?.[selectedEventName]?.payload?.[selectedPayloadFieldName]
      if (field) Object.assign(field, patch)
    })
  }

  const clearSelectedPayloadDefault = () => {
    if (!selectedDefinitionId || !selectedEventName || !selectedPayloadFieldName || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      const field = definition.events?.[selectedEventName]?.payload?.[selectedPayloadFieldName]
      if (field) delete field.default
    })
  }

  const changePayloadFieldType = (type: string) => {
    if (!selectedDefinitionId || !selectedEventName || !selectedPayloadFieldName || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      const field = definition.events?.[selectedEventName]?.payload?.[selectedPayloadFieldName]
      if (!field) return
      field.type = type
      if (type === 'enum') {
        const firstEnum = Object.keys(state.doc.enums ?? {}).sort((a, b) => a.localeCompare(b))[0]
        if (firstEnum) field.enum = firstEnum
      } else {
        delete field.enum
      }
      delete field.default
    })
  }

  const renamePayloadField = (name: string) => {
    if (!selectedDefinitionId || !selectedEventName || !selectedPayloadFieldName || !editable) return
    const clean = name.trim()
    if (!clean || clean === selectedPayloadFieldName) return
    if (selectedDefinition?.events?.[selectedEventName]?.payload?.[clean]) {
      showError(`Payload field "${clean}" already exists.`)
      return
    }
    updateDefinition(selectedDefinitionId, (definition) => {
      const event = definition.events?.[selectedEventName]
      if (!event?.payload?.[selectedPayloadFieldName]) return
      event.payload = Object.fromEntries(
        Object.entries(event.payload).map(([key, value]) => [
          key === selectedPayloadFieldName ? clean : key,
          value,
        ]),
      )
    })
    setSelectedPayloadFieldName(clean)
  }

  const deletePayloadField = (name: string) => {
    if (!selectedDefinitionId || !selectedEventName || !name || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      const event = definition.events?.[selectedEventName]
      if (event?.payload) delete event.payload[name]
    })
    if (selectedPayloadFieldName === name) setSelectedPayloadFieldName(null)
  }

  const renameSelectedEvent = (name: string) => {
    if (!selectedDefinitionId || !selectedEventName || !editable) return
    const clean = name.trim()
    if (!clean || clean === selectedEventName) return
    if (selectedDefinition?.events?.[clean]) {
      showError(`Event "${clean}" already exists.`)
      return
    }
    updateDefinition(selectedDefinitionId, (definition) => {
      const event = definition.events?.[selectedEventName]
      if (!event) return
      definition.events = Object.fromEntries(
        Object.entries(definition.events ?? {}).map(([key, value]) => [
          key === selectedEventName ? clean : key,
          value,
        ]),
      )
    })
    setSelectedEventName(clean)
    setSelectedPayloadFieldName(null)
  }

  const deleteSelectedEvent = (name: string) => {
    if (!selectedDefinitionId || !name || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      if (definition.events) delete definition.events[name]
    })
    if (selectedEventName === name) {
      setSelectedEventName(null)
      setSelectedPayloadFieldName(null)
    }
  }

  const updateEventDoc = (docText: string) => {
    if (!selectedDefinitionId || !selectedEventName || !editable) return
    updateDefinition(selectedDefinitionId, (definition) => {
      const event = definition.events?.[selectedEventName]
      if (!event) return
      if (docText) event.doc = docText
      else delete event.doc
    })
  }

  const renameSelectedEnum = (name: string) => {
    if (!selectedEnumName || !canWrite) return
    const clean = name.trim()
    if (!clean || clean === selectedEnumName) return
    try {
      const next = renameEnumInBundle(state.doc, selectedEnumName, clean)
      replace(next)
      selectEnum(clean)
    } catch (error) {
      showError(error)
    }
  }

  const addEnumValue = () => {
    if (!selectedEnumName || newEnumValue === null || !canWrite) return
    const value = newEnumValue.trim()
    if (!value) return
    if (state.doc.enums?.[selectedEnumName]?.values.includes(value)) {
      showError(`Enum value "${value}" already exists.`)
      return
    }
    update((doc) => {
      const enumDef = doc.enums?.[selectedEnumName]
      if (!enumDef) return
      enumDef.values.push(value)
    })
    setNewEnumValue('')
  }

  const renameEnumValue = (oldValue: string, newValue: string) => {
    if (!selectedEnumName || !canWrite) return
    const clean = newValue.trim()
    if (!clean || clean === oldValue) return
    try {
      const next = renameEnumValueInBundle(state.doc, selectedEnumName, oldValue, clean)
      replace(next)
    } catch (error) {
      showError(error)
    }
  }

  const deleteEnumValue = (value: string) => {
    if (!selectedEnumName || !canWrite) return
    update((doc) => {
      const enumDef = doc.enums?.[selectedEnumName]
      if (!enumDef) return
      enumDef.values = enumDef.values.filter((item) => item !== value)
    })
  }

  const deleteSelectedEnum = () => {
    if (!selectedEnumName || !canWrite) return
    if (enumUsageCount(state.doc, selectedEnumName) > 0) {
      showError('This enum is still used by a field. Change those fields first.')
      return
    }
    if (!window.confirm(`Delete enum "${selectedEnumName}"?`)) return
    try {
      const next = deleteEnumInBundle(state.doc, selectedEnumName)
      replace(next)
      setSelection(initialSelection(next, builtin))
      setSelectedFieldName(null)
      setSelectedEventName(null)
    } catch (error) {
      showError(error)
    }
  }

  const createDefinition = () => {
    if (newDefinitionName === null || !canWrite) return
    try {
      const result = addDefinition(state.doc, newDefinitionName, false)
      replace(result.bundle)
      setSelection({ kind: 'definition', id: result.id })
      setNewDefinitionName(null)
      setTab('fields')
      setSelectedFieldName(null)
      setSelectedEventName(null)
    } catch (error) {
      showError(error)
    }
  }

  const ownFields = selectedDefinition?.fields ?? {}
  const ownFieldKeys = Object.keys(ownFields)
  const ownEvents = selectedDefinition?.events ?? {}
  const ownEventKeys = Object.keys(ownEvents)
  const effectiveFields = selectedEffective?.fields ?? []
  const effectiveEvents = selectedEffective?.events ?? []

  const fieldList = tab === 'fields'
    ? effectiveFields
    : []
  const showAddField = tab === 'fields' && editable
  const showAddEvent = tab === 'events' && editable

  const renderSidebar = () => (
    <aside className="sidebar" aria-label="Schema navigation">
      <div className="sidebar-search">
        <input
          ref={searchRef}
          className="search-input"
          type="search"
          placeholder="Search definitions and fields"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search definitions and fields"
        />
        <span className="kbd-hint">/</span>
      </div>

      <div className="sidebar-scroll">
        <section className="nav-section">
          <div className="nav-heading">
            <span>Abstract</span>
            <span className="count-badge">{abstractEntries.length}</span>
          </div>
          {abstractEntries.length === 0 && <p className="nav-empty">No abstract definitions</p>}
          {abstractEntries.map(([id, definition]) => (
            <DefinitionRow
              key={id}
              id={id}
              definition={definition}
              selected={selectedDefinitionId === id}
              issues={validation.issues.filter((issue) => issue.definitionId === id)}
              onSelect={() => selectDefinition(id)}
            />
          ))}
        </section>

        <section className="nav-section">
          <div className="nav-heading">
            <span>Concrete</span>
            <span className="count-badge">{concreteEntries.length}</span>
          </div>
          {concreteEntries.length === 0 && <p className="nav-empty">No concrete definitions</p>}
          {concreteEntries.map(([id, definition]) => (
            <DefinitionRow
              key={id}
              id={id}
              definition={definition}
              selected={selectedDefinitionId === id}
              issues={validation.issues.filter((issue) => issue.definitionId === id)}
              onSelect={() => selectDefinition(id)}
            />
          ))}
          {canWrite && newDefinitionName === null && (
            <button type="button" className="nav-add" onClick={() => setNewDefinitionName('')}>
              <span aria-hidden="true">+</span> New definition
            </button>
          )}
          {newDefinitionName !== null && (
            <div className="inline-create">
              <input
                autoFocus
                className="text-input"
                value={newDefinitionName}
                placeholder="local name"
                onChange={(event) => setNewDefinitionName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createDefinition()
                  if (event.key === 'Escape') setNewDefinitionName(null)
                }}
              />
              <button type="button" className="button tiny primary" onClick={createDefinition}>Add</button>
            </div>
          )}
        </section>

        <details className="nav-section builtin-section">
          <summary className="nav-heading">
            <span>Builtin</span>
            <span className="count-badge">{builtinEntries.length}</span>
          </summary>
          {builtinEntries.map(([id, definition]) => (
            <DefinitionRow
              key={id}
              id={id}
              definition={definition}
              selected={selectedDefinitionId === id}
              issues={[]}
              builtin
              onSelect={() => selectDefinition(id)}
            />
          ))}
        </details>

        <section className="nav-section">
          <div className="nav-heading">
            <span>Enums</span>
            <span className="count-badge">{enumNames.length}</span>
          </div>
          {enumNames.length === 0 && <p className="nav-empty">No enums yet</p>}
          {enumNames.map((name) => (
            <button
              key={name}
              type="button"
              className={`nav-row enum-row ${selectedEnumName === name ? 'selected' : ''}`}
              onClick={() => selectEnum(name)}
            >
              <span className="enum-icon" aria-hidden="true">◇</span>
              <span className="nav-label">{name}</span>
              <span className="nav-count">{state.doc.enums?.[name]?.values.length ?? 0}</span>
            </button>
          ))}
          {canWrite && newEnumName === null && (
            <button type="button" className="nav-add" onClick={() => setNewEnumName('')}>
              <span aria-hidden="true">+</span> New enum
            </button>
          )}
          {newEnumName !== null && (
            <div className="inline-create">
              <input
                autoFocus
                className="text-input"
                value={newEnumName}
                placeholder="enum name"
                onChange={(event) => setNewEnumName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addEnum()
                  if (event.key === 'Escape') setNewEnumName(null)
                }}
              />
              <button type="button" className="button tiny primary" onClick={addEnum}>Add</button>
            </div>
          )}
        </section>
      </div>

      <div className="sidebar-footer">
        <span>{definitionCount} definitions</span>
        <span>{enumNames.length} enums</span>
      </div>
    </aside>
  )

  const renderInspector = () => {
    if (selectedEnumName) {
      return (
        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-empty">
            <p className="eyebrow">Enum</p>
            <h3>{selectedEnumName}</h3>
            <p className="muted-copy">{enumUsageCount(state.doc, selectedEnumName)} field references in this bundle.</p>
            {enumIssues.length > 0 && (
              <div className="issue-stack">
                {enumIssues.map((issue, index) => (
                  <p key={`${issue.code}-${index}`} className={`field-error ${issue.severity}`}>{issue.message}</p>
                ))}
              </div>
            )}
            <p className="inspector-tip">Enum values are ordered strings. Renaming a value updates defaults in this bundle.</p>
          </div>
        </aside>
      )
    }

    if (selectedEventName && selectedPayloadFieldName && selectedPayloadField) {
      return (
        <aside className="inspector" aria-label="Inspector">
          <FieldEditor
            name={selectedPayloadFieldName}
            field={selectedPayloadField}
            origin={selectedDefinitionId ?? ''}
            inherited={false}
            override={false}
            canEdit={Boolean(editable)}
            enums={state.doc.enums ?? {}}
            issues={[]}
            onChange={updateSelectedPayloadField}
            onChangeType={changePayloadFieldType}
            onRename={renamePayloadField}
            onDelete={() => deletePayloadField(selectedPayloadFieldName ?? '')}
            onClearDefault={clearSelectedPayloadDefault}
            onRemoveOverride={() => undefined}
            onMove={(direction) => {
              if (!selectedDefinitionId || !selectedEventName || !selectedPayloadFieldName) return
              updateDefinition(selectedDefinitionId, (definition) => {
                const event = definition.events?.[selectedEventName]
                if (!event?.payload) return
                event.payload = reorderRecord(event.payload, selectedPayloadFieldName, direction)
              })
            }}
          />
        </aside>
      )
    }

    if (selectedEventName && selectedEventEffective) {
      return (
        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-body">
            <div className="inspector-title">
              <div>
                <p className="eyebrow">Event</p>
                <h3>{selectedEventName}</h3>
              </div>
              {editable && (
                <button type="button" className="icon-button danger" title="Delete event" onClick={() => deleteSelectedEvent(selectedEventName ?? '')}>×</button>
              )}
            </div>
            <div className="origin-row">
              <span className={`badge ${selectedEventEffective.inherited ? 'muted' : 'own'}`}>
                {selectedEventEffective.inherited ? 'inherited' : 'own'}
              </span>
              <code className="origin-code">{selectedEventEffective.origin}</code>
            </div>
            {eventIssues.length > 0 && (
              <div className="issue-stack">
                {eventIssues.map((issue, index) => (
                  <p key={`${issue.code}-${index}`} className={`field-error ${issue.severity}`}>{issue.message}</p>
                ))}
              </div>
            )}
            <label className="field-label">
              Name
              <CommitInput value={selectedEventName} disabled={!editable || selectedEventEffective.inherited} onCommit={renameSelectedEvent} />
            </label>
            <label className="field-label">
              Documentation
              <CommitInput
                multiline
                value={selectedEventEffective.event.doc ?? ''}
                disabled={!editable || selectedEventEffective.inherited}
                placeholder="What this event means."
                onCommit={updateEventDoc}
              />
            </label>
            <div className="field-label">
              Payload
              <p className="muted-copy">
                {Object.keys(selectedEventEffective.event.payload ?? {}).length} field(s). Select one in the table to edit it.
              </p>
            </div>
          </div>
        </aside>
      )
    }

    if (selectedFieldName && selectedFieldEffective) {
      return (
        <aside className="inspector" aria-label="Inspector">
          <FieldEditor
            name={selectedFieldName}
            field={selectedFieldEffective.field}
            origin={selectedFieldEffective.origin}
            inherited={selectedFieldEffective.inherited}
            override={selectedFieldEffective.override}
            canEdit={Boolean(editable)}
            enums={state.doc.enums ?? {}}
            issues={fieldIssues}
            onChange={updateSelectedField}
            onChangeType={changeFieldType}
            onRename={renameField}
            onDelete={() => deleteField(selectedFieldName ?? '')}
            onClearDefault={clearSelectedFieldDefault}
            onRemoveOverride={removeOverride}
            onMove={moveField}
          />
        </aside>
      )
    }

    if (selectedDefinition) {
      return (
        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-empty">
            <p className="eyebrow">Definition</p>
            <h3>{selectedDefinitionId ? definitionLocalName(selectedDefinitionId) : 'Definition'}</h3>
            <p className="muted-copy">{selectedIsBuiltin ? 'Builtin definition, read-only.' : 'Select a field or event to edit it.'}</p>
            <div className="palette-preview">
              <div className="preview-head">
                <span className={selectedDefinition.abstract ? 'badge abstract' : 'badge concrete'}>
                  {selectedDefinition.abstract ? 'abstract' : 'concrete'}
                </span>
                <span className="preview-count">{effectiveFields.length} fields</span>
              </div>
              <code>{selectedDefinitionId}</code>
              <p>{selectedDefinition.doc || 'No documentation yet.'}</p>
            </div>
            {definitionIssues.length > 0 && (
              <div className="issue-stack">
                {definitionIssues.map((issue, index) => (
                  <p key={`${issue.code}-${index}`} className={`field-error ${issue.severity}`}>{issue.message}</p>
                ))}
              </div>
            )}
            <p className="inspector-tip">Press <kbd>?</kbd> for shortcuts. Inherited fields show their origin and any override.</p>
          </div>
        </aside>
      )
    }

    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector-empty">
          <p className="eyebrow">Tenon</p>
          <h3>No selection</h3>
          <p className="muted-copy">Select a definition, field, or enum to inspect it.</p>
          <p className="inspector-tip">Press <kbd>?</kbd> for the keyboard cheat sheet.</p>
        </div>
      </aside>
    )
  }

  return (
    <div className="tenon-app">
      <header className="editor-header">
        <div className="identity-block">
          <div className="identity-mark" aria-hidden="true">T</div>
          <div className="identity-fields">
            <input
              className="identity-id"
              value={state.doc.id}
              disabled={!canWrite}
              aria-label="Schema bundle ID"
              onChange={(event) => update((doc) => { doc.id = event.target.value })}
            />
            <div className="identity-meta">
              <input
                className="identity-meta-input"
                value={state.doc.namespace}
                disabled={!canWrite || definitionCount > 0}
                title={definitionCount > 0 ? 'Namespace is fixed once definitions exist.' : 'Schema namespace'}
                aria-label="Schema namespace"
                onChange={(event) => update((doc) => { doc.namespace = event.target.value })}
              />
              <span className="meta-separator">@</span>
              <input
                className="identity-meta-input"
                value={state.doc.version}
                disabled={!canWrite}
                aria-label="Schema version"
                onChange={(event) => update((doc) => { doc.version = event.target.value })}
              />
            </div>
          </div>
          <span className="path-chip" title={pathRef.current}>{pathRef.current}</span>
        </div>
        <div className="header-actions">
          {!canWrite && <span className="badge readonly">read-only</span>}
          <span className={`save-state ${dirty ? 'dirty' : 'clean'}`}>{currentDirtyLabel}</span>
          <button
            type="button"
            className={`validation-button ${validation.errors > 0 ? 'has-errors' : validation.warnings > 0 ? 'has-warnings' : ''}`}
            onClick={() => setValidationOpen((value) => !value)}
            title="Toggle validation"
          >
            {validation.errors > 0 ? `${validation.errors} errors` : validation.warnings > 0 ? `${validation.warnings} warnings` : 'Valid'}
          </button>
          <button type="button" className="icon-button" title="Keyboard shortcuts" onClick={() => setHelpOpen(true)}>?</button>
        </div>
      </header>

      <div className="editor-main">
        {renderSidebar()}
        <main className="content" aria-label="Schema editor">
          {external && (
            <div className="banner warning external-banner" role="status">
              <span>
                {external.kind === 'deleted'
                  ? 'This file was deleted on disk. Your buffer is intact.'
                  : 'This file changed on disk. Your buffer is intact.'}
              </span>
              <span className="banner-actions">
                {external.kind !== 'deleted' && (
                  <button type="button" className="button tiny" onClick={() => void reloadFromDisk(true)}>Reload</button>
                )}
                <button type="button" className="link-button" onClick={() => setExternal(null)}>Keep editing</button>
              </span>
            </div>
          )}
          {toast && (
            <div className={`${toastClass(toast.kind)} toast`} role={toast.kind === 'error' ? 'alert' : 'status'}>
              <span>{toast.message}</span>
              <button type="button" className="link-button" onClick={() => setToast(null)}>Dismiss</button>
            </div>
          )}

          {selectedEnumName && selectedEnum ? (
            <EnumEditor
              name={selectedEnumName}
              enumDef={selectedEnum}
              canEdit={canWrite}
              issues={enumIssues}
              onRename={renameSelectedEnum}
              onDelete={deleteSelectedEnum}
              onDeleteValue={deleteEnumValue}
              onRenameValue={renameEnumValue}
              onAddValue={() => setNewEnumValue('')}
              newValue={newEnumValue}
              setNewValue={setNewEnumValue}
              commitNewValue={addEnumValue}
              onMoveValue={(direction, value) => {
                update((doc) => {
                  const enumDef = doc.enums?.[selectedEnumName]
                  if (!enumDef) return
                  const index = enumDef.values.indexOf(value)
                  const target = index + direction
                  if (index < 0 || target < 0 || target >= enumDef.values.length) return
                  const next = [...enumDef.values]
                  const [item] = next.splice(index, 1)
                  next.splice(target, 0, item)
                  enumDef.values = next
                })
              }}
            />
          ) : selectedDefinition && selectedDefinitionId ? (
            <DefinitionWorkspace
              definitionId={selectedDefinitionId}
              definition={selectedDefinition}
              builtin={selectedIsBuiltin}
              editable={editable}
              tab={tab}
              setTab={setTab}
              effective={selectedEffective}
              issues={validation.issues}
              definitionIssues={definitionIssues}
              selectedFieldName={selectedFieldName}
              selectedEventName={selectedEventName}
              selectedPayloadFieldName={selectedPayloadFieldName}
              selectField={(name) => {
                setSelectedFieldName(name)
                setSelectedEventName(null)
                setSelectedPayloadFieldName(null)
                setTab('fields')
              }}
              selectEvent={(name) => {
                setSelectedEventName(name)
                setSelectedFieldName(null)
                setSelectedPayloadFieldName(null)
                setTab('events')
              }}
              selectPayloadField={(name) => setSelectedPayloadFieldName(name)}
              enums={state.doc.enums ?? {}}
              allIds={allDefinitionIds(state.doc, builtin)}
              bundle={state.doc}
              builtinBundle={builtin}
              onRenameDefinition={renameSelectedDefinition}
              onToggleAbstract={toggleAbstract}
              onDeleteDefinition={deleteSelectedDefinition}
              onDocChange={(value) => updateDefinition(selectedDefinitionId, (definition) => {
                if (value) definition.doc = value
                else delete definition.doc
              })}
              onAddComposition={addComposition}
              onRemoveComposition={removeComposition}
              onAddField={addField}
              newFieldName={newFieldName}
              setNewFieldName={setNewFieldName}
              newFieldType={newFieldType}
              setNewFieldType={setNewFieldType}
              onAddEvent={addEvent}
              newEventName={newEventName}
              setNewEventName={setNewEventName}
              onAddPayloadField={addPayloadField}
              newPayloadName={newPayloadName}
              setNewPayloadName={setNewPayloadName}
              newPayloadType={newPayloadType}
              setNewPayloadType={setNewPayloadType}
              onDeleteField={deleteField}
              onDeletePayloadField={deletePayloadField}
              onDeleteEvent={deleteSelectedEvent}
            />
          ) : (
            <div className="workspace-empty">
              <div className="empty-glyph" aria-hidden="true">◇</div>
              <h2>No definition selected</h2>
              <p>Select a definition in the sidebar or create a new one.</p>
            </div>
          )}
        </main>
        {renderInspector()}
      </div>

      <footer className="statusbar">
        <div className="status-left">
          <button type="button" className="status-validation" onClick={() => setValidationOpen((value) => !value)}>
            <span className={validation.errors > 0 ? 'status-dot error' : 'status-dot ok'} />
            {validation.errors} {validation.errors === 1 ? 'error' : 'errors'}
            <span className="status-separator">·</span>
            {validation.warnings} {validation.warnings === 1 ? 'warning' : 'warnings'}
          </button>
          <span className="status-schema">{state.doc.namespace}@{state.doc.version}</span>
        </div>
        <div className="status-right">
          <span>{canWrite ? 'Ctrl/Cmd+S saves' : 'Read-only workspace'}</span>
          <span className="status-separator">·</span>
          <span>M1 schema editor</span>
        </div>
      </footer>

      {validationOpen && (
        <div className="drawer-backdrop" onClick={() => setValidationOpen(false)}>
          <section className="validation-drawer" onClick={(event) => event.stopPropagation()} aria-label="Validation">
            <header className="drawer-header">
              <div>
                <p className="eyebrow">Validation</p>
                <h3>{validation.errors} errors, {validation.warnings} warnings</h3>
              </div>
              <button type="button" className="icon-button" onClick={() => setValidationOpen(false)}>×</button>
            </header>
            <div className="drawer-list">
              {validation.issues.length === 0 ? (
                <p className="drawer-empty">No issues. The schema bundle is valid.</p>
              ) : (
                validation.issues.map((issue, index) => (
                  <button
                    key={`${issue.code}-${index}`}
                    type="button"
                    className={`issue-row ${issue.severity}`}
                    onClick={() => openIssue(issue)}
                  >
                    <span className={`status-dot ${issue.severity === 'error' ? 'error' : 'warning'}`} />
                    <span className="issue-copy">
                      <strong>{issue.message}</strong>
                      <small>{issue.definitionId ?? issue.enumName ?? 'Schema bundle'}{issue.fieldName ? ` · ${issue.fieldName}` : ''}</small>
                    </span>
                    <span className="issue-jump">Jump</span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {helpOpen && (
        <div className="drawer-backdrop" onClick={() => setHelpOpen(false)}>
          <section className="help-panel" onClick={(event) => event.stopPropagation()} aria-label="Keyboard shortcuts">
            <header className="drawer-header">
              <div>
                <p className="eyebrow">Keyboard</p>
                <h3>Shortcuts</h3>
              </div>
              <button type="button" className="icon-button" onClick={() => setHelpOpen(false)}>×</button>
            </header>
            <div className="shortcut-grid">
              {[
                ['/', 'Focus search'],
                ['N', 'New definition'],
                ['F', 'Add field'],
                ['E', 'Add event'],
                ['Shift+E', 'New enum'],
                ['Cmd/Ctrl+S', 'Save'],
                ['Cmd/Ctrl+Z', 'Undo'],
                ['Cmd/Ctrl+Shift+Z', 'Redo'],
                ['?', 'Toggle this panel'],
                ['Esc', 'Close overlays'],
              ].map(([key, action]) => (
                <div key={key} className="shortcut-row">
                  <kbd>{key}</kbd><span>{action}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function DefinitionRow(props: {
  id: string
  definition: SchemaDefinition
  selected: boolean
  issues: ValidationIssue[]
  builtin?: boolean
  onSelect: () => void
}) {
  const errors = props.issues.filter((issue) => issue.severity === 'error').length
  const warnings = props.issues.filter((issue) => issue.severity === 'warning').length
  return (
    <button
      type="button"
      className={`nav-row ${props.selected ? 'selected' : ''} ${props.builtin ? 'builtin' : ''}`}
      onClick={props.onSelect}
      title={props.id}
    >
      <span className={`status-dot ${errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'ok'}`} />
      <span className="nav-label">{definitionLocalName(props.id)}</span>
      {props.definition.abstract && <span className="nav-badge">A</span>}
      <span className="nav-count">{Object.keys(props.definition.fields ?? {}).length}</span>
    </button>
  )
}

function DefinitionWorkspace(props: {
  definitionId: string
  definition: SchemaDefinition
  builtin: boolean
  editable: boolean
  tab: DetailTab
  setTab: (tab: DetailTab) => void
  effective: EffectiveDefinition | null
  issues: ValidationIssue[]
  definitionIssues: ValidationIssue[]
  selectedFieldName: string | null
  selectedEventName: string | null
  selectedPayloadFieldName: string | null
  selectField: (name: string) => void
  selectEvent: (name: string) => void
  selectPayloadField: (name: string) => void
  enums: Record<string, SchemaEnum>
  allIds: string[]
  bundle: SchemaBundle
  builtinBundle: SchemaBundle
  onRenameDefinition: (name: string) => void
  onToggleAbstract: () => void
  onDeleteDefinition: () => void
  onDocChange: (value: string) => void
  onAddComposition: (id: string) => void
  onRemoveComposition: (id: string) => void
  onAddField: () => void
  newFieldName: string | null
  setNewFieldName: (value: string | null) => void
  newFieldType: string
  setNewFieldType: (value: string) => void
  onAddEvent: () => void
  newEventName: string | null
  setNewEventName: (value: string | null) => void
  onAddPayloadField: () => void
  newPayloadName: string | null
  setNewPayloadName: (value: string | null) => void
  newPayloadType: string
  setNewPayloadType: (value: string) => void
  onDeleteField: (name: string) => void
  onDeletePayloadField: (name: string) => void
  onDeleteEvent: (name: string) => void
}) {
  const fields = props.effective?.fields ?? []
  const events = props.effective?.events ?? []
  const selectedEvent = props.selectedEventName
    ? events.find((event) => event.name === props.selectedEventName)
    : undefined
  const payloadFields = selectedEvent?.event.payload ?? {}
  const payloadEditable = props.editable && Boolean(selectedEvent && !selectedEvent.inherited)

  return (
    <article className="definition-workspace">
      <header className="definition-header">
        <div className="definition-title">
          <div className="definition-id-line">
            <CommitInput
              className="definition-name-input"
              value={definitionLocalName(props.definitionId)}
              disabled={!props.editable || props.builtin}
              onCommit={props.onRenameDefinition}
            />
            <span className="qualified-id">{props.definitionId}</span>
            {props.builtin && <span className="badge readonly">builtin</span>}
          </div>
          <div className="definition-controls">
            <button
              type="button"
              className={`segmented ${props.definition.abstract ? 'active' : ''}`}
              disabled={!props.editable || props.builtin}
              onClick={props.onToggleAbstract}
            >
              {props.definition.abstract ? 'Abstract' : 'Concrete'}
            </button>
            {!props.builtin && (
              <button
                type="button"
                className="button ghost tiny danger-text"
                disabled={!props.editable}
                onClick={props.onDeleteDefinition}
              >
                Delete
              </button>
            )}
          </div>
        </div>
        <CommitInput
          multiline
          className="definition-doc"
          value={props.definition.doc ?? ''}
          disabled={!props.editable || props.builtin}
          placeholder="Document this definition for schema authors."
          onCommit={props.onDocChange}
        />
        <CompositionChips
          definitionId={props.definitionId}
          definition={props.definition}
          editable={props.editable && !props.builtin}
          allIds={props.allIds}
          bundle={props.bundle}
          builtin={props.builtinBundle}
          onAdd={props.onAddComposition}
          onRemove={props.onRemoveComposition}
        />
        {props.definitionIssues.length > 0 && (
          <div className="issue-stack">
            {props.definitionIssues.map((issue, index) => (
              <p key={`${issue.code}-${index}`} className={`field-error ${issue.severity}`}>{issue.message}</p>
            ))}
          </div>
        )}
      </header>

      <div className="tab-bar" role="tablist">
        <button type="button" role="tab" aria-selected={props.tab === 'fields'} className={props.tab === 'fields' ? 'active' : ''} onClick={() => props.setTab('fields')}>
          Fields <span className="tab-count">{fields.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={props.tab === 'events'} className={props.tab === 'events' ? 'active' : ''} onClick={() => props.setTab('events')}>
          Events <span className="tab-count">{events.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={props.tab === 'effective'} className={props.tab === 'effective' ? 'active' : ''} onClick={() => props.setTab('effective')}>
          Effective
        </button>
      </div>

      {props.tab === 'fields' && (
        <section className="table-section">
          <table className="data-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Default</th>
                <th>Origin</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {fields.length === 0 && (
                <tr><td colSpan={5} className="table-empty">No fields yet. Add one below or compose a definition.</td></tr>
              )}
              {fields.map((field) => {
                const issueCount = props.issues.filter(
                  (issue) => issue.definitionId === props.definitionId && issue.fieldName === field.name,
                ).length
                return (
                  <tr
                    key={field.name}
                    className={`${props.selectedFieldName === field.name ? 'selected' : ''} ${field.inherited ? 'inherited' : ''}`}
                    onClick={() => props.selectField(field.name)}
                  >
                    <td>
                      <span className="field-name">
                        {issueCount > 0 && <span className="status-dot error" />}
                        {field.name}
                        {field.override && <span className="badge override">override</span>}
                      </span>
                    </td>
                    <td><span className={`type-pill type-${field.field.type.split('<')[0]}`}>{TYPE_LABELS[field.field.type] ?? field.field.type}</span></td>
                    <td className="default-cell">{defaultPreview(field.field)}</td>
                    <td><span className={`badge ${field.inherited ? 'muted' : 'own'}`}>{field.inherited ? field.origin.split(':').at(-1) : 'own'}</span></td>
                    <td className="row-actions">
                      {props.editable && !field.inherited && (
                        <button
                          type="button"
                          className="icon-button tiny"
                          title="Delete field"
                          onClick={(event) => { event.stopPropagation(); props.onDeleteField(field.name) }}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {props.editable && (
            <div className="add-row">
              {props.newFieldName === null ? (
                <button type="button" className="nav-add" onClick={() => props.setNewFieldName('')}>
                  <span aria-hidden="true">+</span> Field
                </button>
              ) : (
                <div className="add-form">
                  <input
                    autoFocus
                    className="text-input"
                    value={props.newFieldName}
                    placeholder="field name"
                    onChange={(event) => props.setNewFieldName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') props.onAddField()
                      if (event.key === 'Escape') props.setNewFieldName(null)
                    }}
                  />
                  <TypeSelect value={props.newFieldType} onChange={props.setNewFieldType} />
                  <button type="button" className="button tiny primary" onClick={props.onAddField}>Add</button>
                  <button type="button" className="button tiny ghost" onClick={() => props.setNewFieldName(null)}>Cancel</button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {props.tab === 'events' && (
        <section className="table-section">
          <table className="data-table event-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Payload</th>
                <th>Origin</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr><td colSpan={4} className="table-empty">No events yet.</td></tr>
              )}
              {events.map((event) => {
                const issueCount = props.issues.filter(
                  (issue) => issue.definitionId === props.definitionId && issue.eventName === event.name,
                ).length
                return (
                  <tr
                    key={event.name}
                    className={props.selectedEventName === event.name ? 'selected' : ''}
                    onClick={() => props.selectEvent(event.name)}
                  >
                    <td><span className="field-name">{issueCount > 0 && <span className="status-dot error" />}{event.name}</span></td>
                    <td className="default-cell">{payloadSummary(event.event)}</td>
                    <td><span className={`badge ${event.inherited ? 'muted' : 'own'}`}>{event.inherited ? event.origin.split(':').at(-1) : 'own'}</span></td>
                    <td className="row-actions">
                      {props.editable && !event.inherited && (
                        <button
                          type="button"
                          className="icon-button tiny"
                          title="Delete event"
                          onClick={(clickEvent) => { clickEvent.stopPropagation(); props.onDeleteEvent(event.name) }}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {props.editable && (
            <div className="add-row">
              {props.newEventName === null ? (
                <button type="button" className="nav-add" onClick={() => props.setNewEventName('')}>
                  <span aria-hidden="true">+</span> Event
                </button>
              ) : (
                <div className="add-form">
                  <input
                    autoFocus
                    className="text-input"
                    value={props.newEventName}
                    placeholder="event name"
                    onChange={(event) => props.setNewEventName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') props.onAddEvent()
                      if (event.key === 'Escape') props.setNewEventName(null)
                    }}
                  />
                  <button type="button" className="button tiny primary" onClick={props.onAddEvent}>Add</button>
                  <button type="button" className="button tiny ghost" onClick={() => props.setNewEventName(null)}>Cancel</button>
                </div>
              )}
            </div>
          )}

          {selectedEvent && (
            <section className="payload-section">
              <div className="section-heading compact">
                <div>
                  <h3>Payload</h3>
                  <p>{Object.keys(payloadFields).length} field(s)</p>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Field</th><th>Type</th><th>Default</th><th aria-label="Actions" /></tr>
                </thead>
                <tbody>
                  {Object.entries(payloadFields).length === 0 && (
                    <tr><td colSpan={4} className="table-empty">No payload fields.</td></tr>
                  )}
                  {Object.entries(payloadFields).map(([name, field]) => (
                    <tr
                      key={name}
                      className={props.selectedPayloadFieldName === name ? 'selected' : ''}
                      onClick={() => props.selectPayloadField(name)}
                    >
                      <td>{name}</td>
                      <td><span className={`type-pill type-${field.type.split('<')[0]}`}>{TYPE_LABELS[field.type] ?? field.type}</span></td>
                      <td className="default-cell">{defaultPreview(field)}</td>
                      <td className="row-actions">
                        {payloadEditable && (
                          <button
                            type="button"
                            className="icon-button tiny"
                            title="Delete payload field"
                            onClick={(clickEvent) => { clickEvent.stopPropagation(); props.onDeletePayloadField(name) }}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {payloadEditable && (
                <div className="add-row">
                  {props.newPayloadName === null ? (
                    <button type="button" className="nav-add" onClick={() => props.setNewPayloadName('')}>
                      <span aria-hidden="true">+</span> Payload field
                    </button>
                  ) : (
                    <div className="add-form">
                      <input
                        autoFocus
                        className="text-input"
                        value={props.newPayloadName}
                        placeholder="payload field"
                        onChange={(event) => props.setNewPayloadName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') props.onAddPayloadField()
                          if (event.key === 'Escape') props.setNewPayloadName(null)
                        }}
                      />
                      <TypeSelect value={props.newPayloadType} onChange={props.setNewPayloadType} />
                      <button type="button" className="button tiny primary" onClick={props.onAddPayloadField}>Add</button>
                      <button type="button" className="button tiny ghost" onClick={() => props.setNewPayloadName(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </section>
      )}

      {props.tab === 'effective' && (
        <section className="table-section effective-section">
          <div className="effective-note">
            This is the flat definition the runtime and inspector will see.
          </div>
          <table className="data-table">
            <thead><tr><th>Field</th><th>Type</th><th>Effective default</th><th>Origin</th></tr></thead>
            <tbody>
              {fields.length === 0 && <tr><td colSpan={4} className="table-empty">No fields.</td></tr>}
              {fields.map((field) => (
                <tr key={`field-${field.name}`} className={field.inherited ? 'inherited' : ''}>
                  <td>{field.name}{field.override && <span className="badge override">override</span>}</td>
                  <td><span className={`type-pill type-${field.field.type.split('<')[0]}`}>{TYPE_LABELS[field.field.type] ?? field.field.type}</span></td>
                  <td className="default-cell">{defaultPreview(field.field)}</td>
                  <td><span className={`badge ${field.inherited ? 'muted' : 'own'}`}>{field.origin}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="data-table">
            <thead><tr><th>Event</th><th>Payload</th><th>Origin</th></tr></thead>
            <tbody>
              {events.length === 0 && <tr><td colSpan={3} className="table-empty">No events.</td></tr>}
              {events.map((event) => (
                <tr key={`event-${event.name}`} className={event.inherited ? 'inherited' : ''}>
                  <td>{event.name}</td>
                  <td className="default-cell">{payloadSummary(event.event)}</td>
                  <td><span className={`badge ${event.inherited ? 'muted' : 'own'}`}>{event.origin}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </article>
  )
}

function CompositionChips(props: {
  definitionId: string
  definition: SchemaDefinition
  editable: boolean
  allIds: string[]
  bundle: SchemaBundle
  builtin: SchemaBundle
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const compose = Array.isArray(props.definition.compose) ? props.definition.compose : []
  const candidates = props.allIds
    .filter((id) => id !== props.definitionId)
    .filter((id) => {
      if (!query.trim()) return true
      return id.toLowerCase().includes(query.trim().toLowerCase())
    })
  const close = () => { setOpen(false); setQuery('') }

  return (
    <div className="composition-row">
      <span className="composition-label">Compose</span>
      <div className="chips">
        {compose.length === 0 && <span className="muted-copy">Nothing composed</span>}
        {compose.map((id) => (
          <span key={id} className="chip">
            {id}
            {props.editable && (
              <button type="button" className="chip-remove" title={`Remove ${id}`} onClick={() => props.onRemove(id)}>×</button>
            )}
          </span>
        ))}
        {props.editable && (
          <button type="button" className="chip-add" onClick={() => setOpen(true)}>+</button>
        )}
      </div>

      {open && (
        <div className="popover-backdrop" onClick={close}>
          <div className="popover" onClick={(event) => event.stopPropagation()}>
            <header className="popover-header">
              <div>
                <p className="eyebrow">Compose</p>
                <h3>Add a definition</h3>
              </div>
              <button type="button" className="icon-button" onClick={close}>×</button>
            </header>
            <input
              autoFocus
              className="text-input"
              placeholder="Search definitions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="picker-list">
              {candidates.length === 0 && <p className="drawer-empty">No matching definitions.</p>}
              {candidates.map((id) => {
                const already = compose.includes(id)
                const cycle = wouldCreateCycle(props.bundle, props.definitionId, id, props.builtin)
                const disabled = already || cycle
                return (
                  <button
                    key={id}
                    type="button"
                    className="picker-row"
                    disabled={disabled}
                    onClick={() => { props.onAdd(id); close() }}
                    title={cycle ? 'This would create a composition cycle.' : id}
                  >
                    <span className="picker-name">{id}</span>
                    <span className="picker-meta">
                      {already ? 'already composed' : cycle ? 'cycle' : 'add'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TypeSelect(props: { value: string; onChange: (value: string) => void }) {
  return (
    <select className="select-input" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
      {MVP_FIELD_TYPES.map((type) => (
        <option key={type} value={type}>{TYPE_LABELS[type] ?? type}</option>
      ))}
    </select>
  )
}

function payloadSummary(event: SchemaEvent): string {
  const entries = Object.entries(event.payload ?? {})
  if (entries.length === 0) return '—'
  return entries.map(([name, field]) => `${name}: ${field.type}`).join(', ')
}

function EnumEditor(props: {
  name: string
  enumDef: SchemaEnum
  canEdit: boolean
  issues: ValidationIssue[]
  onRename: (name: string) => void
  onDelete: () => void
  onDeleteValue: (value: string) => void
  onRenameValue: (oldValue: string, newValue: string) => void
  onAddValue: () => void
  newValue: string | null
  setNewValue: (value: string | null) => void
  commitNewValue: () => void
  onMoveValue: (direction: -1 | 1, value: string) => void
}) {
  return (
    <article className="definition-workspace enum-workspace">
      <header className="definition-header">
        <div className="definition-title">
          <div className="definition-id-line">
            <CommitInput
              className="definition-name-input"
              value={props.name}
              disabled={!props.canEdit}
              onCommit={props.onRename}
            />
            <span className="qualified-id">enum</span>
          </div>
          <div className="definition-controls">
            <span className="badge concrete">{props.enumDef.values.length} values</span>
            {props.canEdit && (
              <button type="button" className="button ghost tiny danger-text" onClick={props.onDelete}>Delete enum</button>
            )}
          </div>
        </div>
        {props.issues.length > 0 && (
          <div className="issue-stack">
            {props.issues.map((issue, index) => (
              <p key={`${issue.code}-${index}`} className={`field-error ${issue.severity}`}>{issue.message}</p>
            ))}
          </div>
        )}
      </header>

      <section className="table-section">
        <table className="data-table">
          <thead><tr><th>Value</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {props.enumDef.values.length === 0 && (
              <tr><td colSpan={2} className="table-empty">No values yet.</td></tr>
            )}
            {props.enumDef.values.map((value, index) => (
              <tr key={value}>
                <td>
                  <CommitInput value={value} disabled={!props.canEdit} onCommit={(next) => props.onRenameValue(value, next)} />
                </td>
                <td className="row-actions">
                  {props.canEdit && (
                    <>
                      <button type="button" className="icon-button tiny" title="Move up" onClick={() => props.onMoveValue(-1, value)}>↑</button>
                      <button type="button" className="icon-button tiny" title="Move down" onClick={() => props.onMoveValue(1, value)}>↓</button>
                      <button type="button" className="icon-button tiny danger" title="Delete value" onClick={() => props.onDeleteValue(value)}>×</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {props.canEdit && (
          <div className="add-row">
            {props.newValue === null ? (
              <button type="button" className="nav-add" onClick={props.onAddValue}>
                <span aria-hidden="true">+</span> Value
              </button>
            ) : (
              <div className="add-form">
                <input
                  autoFocus
                  className="text-input"
                  value={props.newValue}
                  placeholder="enum value"
                  onChange={(event) => props.setNewValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') props.commitNewValue()
                    if (event.key === 'Escape') props.setNewValue(null)
                  }}
                />
                <button type="button" className="button tiny primary" onClick={props.commitNewValue}>Add</button>
                <button type="button" className="button tiny ghost" onClick={() => props.setNewValue(null)}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </section>
    </article>
  )
}

