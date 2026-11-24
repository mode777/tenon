export function schemaLabel(originDefinitionId: string): string {
  const namespace = originDefinitionId.split(':')[0]
  return namespace || originDefinitionId
}

export function fieldTypeLabel(field: { type: string; enum?: string }): string {
  if (field.type === 'enum' && field.enum) return field.enum
  return field.type
}
