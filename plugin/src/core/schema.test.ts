import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addDefinition,
  addImportToBundle,
  builtinBundle,
  cloneJson,
  effectiveDefinition,
  lookupFieldEnum,
  parseSchemaText,
  removeImportFromBundle,
  renameDefinitionInBundle,
  renameEnumInBundle,
  renameEnumValueInBundle,
  renameNamespaceInBundle,
  resolveSchemaImports,
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

function shared(): SchemaBundle {
  return {
    id: 'com.example.shared',
    version: '1.0.0',
    namespace: 'shared',
    enums: {
      Kind: { values: ['primary', 'secondary'] },
    },
    definitions: {
      'shared:base': {
        abstract: true,
        fields: {
          weight: { type: 'float', default: 1 },
          kind: { type: 'enum', enum: 'Kind', default: 'primary' },
        },
        events: {
          changed: {
            payload: {
              kind: { type: 'enum', enum: 'Kind', default: 'primary' },
            },
          },
        },
      },
    },
  }
}

function withImportedBase(): SchemaBundle {
  const bundle = sample()
  bundle.imports = { shared: '1.0.0' }
  bundle.definitions['game:button'].compose = ['game:renderable', 'shared:base']
  bundle.definitions['game:button'].fields!.tint = {
    type: 'enum',
    enum: 'shared:Kind',
    default: 'secondary',
  }
  return bundle
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

  it('composes imported definitions and resolves imported enums', () => {
    const bundle = withImportedBase()
    const imported = { shared: shared() }
    const result = validateSchema(bundle, builtinBundle(), imported)
    expect(result.errors).toBe(0)

    const effective = effectiveDefinition('game:button', bundle, builtinBundle(), imported)
    const weight = effective.fields.find((field) => field.name === 'weight')
    expect(weight?.origin).toBe('shared:base')
    expect(weight?.inherited).toBe(true)

    const kind = effective.fields.find((field) => field.name === 'kind')
    expect(kind).toBeTruthy()
    const enumLookup = lookupFieldEnum(
      kind!.field,
      kind!.origin,
      bundle,
      builtinBundle(),
      imported,
    )
    expect(enumLookup?.key).toBe('shared:Kind')
    expect(enumLookup?.enumDef.values).toEqual(['primary', 'secondary'])

    const tint = effective.fields.find((field) => field.name === 'tint')
    expect(lookupFieldEnum(tint!.field, tint!.origin, bundle, builtinBundle(), imported)?.key)
      .toBe('shared:Kind')
  })

  it('validates a consumer override of an imported enum field', () => {
    const bundle = withImportedBase()
    bundle.definitions['game:button'].fields!.kind = {
      type: 'enum',
      enum: 'shared:Kind',
      default: 'secondary',
    }
    const imported = { shared: shared() }
    expect(validateSchema(bundle, builtinBundle(), imported).errors).toBe(0)
    const effective = effectiveDefinition('game:button', bundle, builtinBundle(), imported)
    expect(effective.fields.find((field) => field.name === 'kind')?.override).toBe(true)
  })

  it('reports missing, undeclared, and mismatched imports', () => {
    const bundle = withImportedBase()
    const missing = validateSchema(bundle, builtinBundle())
    expect(missing.issues.some((issue) => issue.code === 'missing-import')).toBe(true)

    const undeclared = withImportedBase()
    delete undeclared.imports
    const undeclaredResult = validateSchema(undeclared, builtinBundle(), { shared: shared() })
    expect(undeclaredResult.issues.some((issue) => issue.code === 'undeclared-import')).toBe(true)

    const mismatched = withImportedBase()
    mismatched.imports = { shared: '2.0.0' }
    const mismatchResult = validateSchema(mismatched, builtinBundle(), { shared: shared() })
    expect(mismatchResult.issues.some((issue) => issue.code === 'import-version')).toBe(true)
  })

  it('validates imported enum references and defaults', () => {
    const bundle = withImportedBase()
    const imported = { shared: shared() }
    bundle.definitions['game:button'].fields!.tint = {
      type: 'enum',
      enum: 'shared:missing',
    }
    expect(
      validateSchema(bundle, builtinBundle(), imported).issues.some((issue) => issue.code === 'missing-enum'),
    ).toBe(true)

    bundle.definitions['game:button'].fields!.tint = {
      type: 'enum',
      enum: 'shared:Kind',
      default: 'danger',
    }
    expect(
      validateSchema(bundle, builtinBundle(), imported).issues.some((issue) => issue.code === 'enum-default'),
    ).toBe(true)

    delete bundle.imports
    expect(
      validateSchema(bundle, builtinBundle(), imported).issues.some(
        (issue) => issue.code === 'undeclared-import',
      ),
    ).toBe(true)
  })

  it('renames the bundle namespace and rewrites local qualified references', () => {
    const bundle = withImportedBase()
    bundle.definitions['game:button'].fields!.style = {
      type: 'enum',
      enum: 'game:ButtonStyle',
      default: 'primary',
    }
    const next = renameNamespaceInBundle(bundle, 'studio')
    expect(next.namespace).toBe('studio')
    expect(next.definitions['studio:button']).toBeTruthy()
    expect(next.definitions['game:button']).toBeUndefined()
    expect(next.definitions['studio:button'].compose).toEqual([
      'studio:renderable',
      'shared:base',
    ])
    expect(next.definitions['studio:button'].fields!.style.enum).toBe('studio:ButtonStyle')
    expect(next.imports).toEqual({ shared: '1.0.0' })
  })

  it('resolves schema packages from the project map and transitively', () => {
    const core: SchemaBundle = {
      id: 'com.example.core',
      version: '1.0.0',
      namespace: 'core',
      definitions: { 'core:thing': { fields: {} } },
    }
    const middle = shared()
    middle.imports = { core: '1.0.0' }
    middle.definitions['shared:base'].compose = ['core:thing']
    const bundle = withImportedBase()
    bundle.imports = { shared: '1.0.0' }
    const resolved = resolveSchemaImports(
      bundle,
      [
        { path: '/schemas/middle.schema.json', bundle: middle },
        { path: '/schemas/core.schema.json', bundle: core },
      ],
      { shared: 'schemas/middle.schema.json' },
    )
    expect(resolved.bundles.shared).toBe(middle)
    expect(resolved.bundles.core).toBe(core)
    expect(resolved.issues).toEqual([])
  })

  it('validates the demo workspace package import', () => {
    const read = (path: string) =>
      JSON.parse(readFileSync(new URL(`../../../examples/m1-workspace/${path}`, import.meta.url), 'utf8')) as SchemaBundle
    const gameA = read('schemas/gameA.schema.json')
    const sharedBundle = read('schemas/shared.schema.json')
    const resolved = resolveSchemaImports(
      gameA,
      [{ path: '/schemas/shared.schema.json', bundle: sharedBundle }],
      { shared: 'schemas/shared.schema.json' },
    )
    expect(resolved.issues).toEqual([])
    const result = validateSchema(gameA, builtinBundle(), resolved.bundles)
    expect(result.errors).toBe(0)
    const effective = effectiveDefinition('gameA:button', gameA, builtinBundle(), resolved.bundles)
    expect(effective.fields.some((field) => field.origin === 'shared:tintable')).toBe(true)
  })

  it('adds and removes a schema import without mutating the source', () => {
    const bundle = sample()
    const withImport = addImportToBundle(bundle, 'shared', '1.0.0')
    expect(withImport.imports).toEqual({ shared: '1.0.0' })
    expect(bundle.imports).toBeUndefined()
    const removed = removeImportFromBundle(withImport, 'shared')
    expect(removed.imports).toBeUndefined()
  })

  it('does not mutate the source bundle', () => {
    const bundle = sample()
    const snapshot = cloneJson(bundle)
    renameDefinitionInBundle(bundle, 'game:button', 'game:actionButton')
    expect(bundle).toEqual(snapshot)
  })
})
