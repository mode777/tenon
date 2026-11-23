import { describe, expect, it } from 'vitest'
import {
  addDefinition,
  builtinBundle,
  cloneJson,
  effectiveDefinition,
  parseSchemaText,
  renameDefinitionInBundle,
  renameEnumInBundle,
  renameEnumValueInBundle,
  schemaToText,
  validateSchema,
  wouldCreateCycle,
  type SchemaBundle,
} from './schema'

function sample(): SchemaBundle {
  return {
    id: 'com.example.game',
    version: '1.0.0',
    namespace: 'game',
    enums: {
      ButtonStyle: { values: ['primary', 'secondary'] },
    },
    definitions: {
      'game:renderable': {
        abstract: true,
        fields: {
          visible: { type: 'bool', default: true },
          castShadows: { type: 'bool', default: true },
        },
      },
      'game:button': {
        compose: ['game:renderable', 'basic3d:renderable'],
        fields: {
          label: { type: 'string', default: 'Press' },
          style: { type: 'enum', enum: 'ButtonStyle', default: 'primary' },
        },
        events: {
          pressed: {},
        },
      },
    },
  }
}

describe('schema model', () => {
  it('round-trips a schema bundle', () => {
    const initial = sample()
    const parsed = parseSchemaText(schemaToText(initial))
    expect(parsed).toEqual(initial)
  })

  it('validates the builtin bundle', () => {
    const result = validateSchema(builtinBundle(), null)
    expect(result.errors).toBe(0)
  })

  it('resolves effective fields with origin and override metadata', () => {
    const bundle = sample()
    bundle.definitions['game:button'].fields!.label = { type: 'string', default: 'Open' }
    const effective = effectiveDefinition('game:button', bundle, builtinBundle())
    const label = effective.fields.find((field) => field.name === 'label')
    expect(label?.origin).toBe('game:button')
    expect(label?.inherited).toBe(false)
    const visible = effective.fields.find((field) => field.name === 'visible')
    expect(visible?.origin).toBe('game:renderable')
    expect(visible?.inherited).toBe(true)
  })

  it('detects a composition cycle', () => {
    const bundle = sample()
    bundle.definitions['game:renderable'].compose = ['game:button']
    const result = validateSchema(bundle, builtinBundle())
    expect(result.issues.some((issue) => issue.code === 'composition-cycle')).toBe(true)
    expect(wouldCreateCycle(bundle, 'game:button', 'game:renderable', builtinBundle())).toBe(true)
  })

  it('detects a field collision across origins', () => {
    const bundle = sample()
    bundle.definitions['game:labelable'] = {
      abstract: true,
      fields: { visible: { type: 'bool', default: false } },
    }
    bundle.definitions['game:button'].compose = ['game:renderable', 'game:labelable']
    const result = validateSchema(bundle, builtinBundle())
    expect(result.issues.some((issue) => issue.code === 'field-collision')).toBe(true)
  })

  it('rejects an invalid enum default', () => {
    const bundle = sample()
    bundle.definitions['game:button'].fields!.style = {
      type: 'enum',
      enum: 'ButtonStyle',
      default: 'missing',
    }
    const result = validateSchema(bundle, builtinBundle())
    expect(result.issues.some((issue) => issue.code === 'enum-default')).toBe(true)
  })

  it('renames a definition and updates local composition references', () => {
    const bundle = sample()
    bundle.definitions['game:panel'] = { compose: ['game:button'] }
    const next = renameDefinitionInBundle(bundle, 'game:button', 'game:actionButton')
    expect(next.definitions['game:actionButton']).toBeTruthy()
    expect(next.definitions['game:button']).toBeUndefined()
    expect(next.definitions['game:panel'].compose).toEqual(['game:actionButton'])
  })

  it('renames enum references and defaults', () => {
    const bundle = sample()
    const renamed = renameEnumInBundle(bundle, 'ButtonStyle', 'ActionStyle')
    expect(renamed.definitions['game:button'].fields!.style.enum).toBe('ActionStyle')
    const valueRenamed = renameEnumValueInBundle(renamed, 'ActionStyle', 'primary', 'main')
    expect(valueRenamed.definitions['game:button'].fields!.style.default).toBe('main')
  })

  it('creates a definition with a unique namespace-qualified ID', () => {
    const bundle = sample()
    const result = addDefinition(bundle, 'trigger', false)
    expect(result.id).toBe('game:trigger')
    expect(result.bundle.definitions[result.id]).toEqual({ fields: {}, events: {} })
  })

  it('does not mutate the source bundle', () => {
    const bundle = sample()
    const snapshot = cloneJson(bundle)
    renameDefinitionInBundle(bundle, 'game:button', 'game:actionButton')
    expect(bundle).toEqual(snapshot)
  })
})
