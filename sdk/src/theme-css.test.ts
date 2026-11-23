import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>
  sideEffects: string[]
}

const COLOR_TOKENS = [
  'bg',
  'fg',
  'muted-fg',
  'border',
  'surface',
  'surface-hover',
  'accent',
  'accent-fg',
  'accent-hover',
  'focus',
  'link',
  'selection-bg',
  'selection-fg',
  'input-bg',
  'input-fg',
  'input-border',
  'danger',
  'warning',
  'success',
]

const SHARED_TOKENS = ['font-ui', 'font-mono', 'font-size', 'radius']

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Theme block not found: ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error(`Unclosed theme block: ${selector}`)
}

function tokens(source: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of source.matchAll(/--exo-([\w-]+):\s*([^;]+);/g)) {
    found.set(match[1], match[2].trim())
  }
  return found
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background))
  const dark = Math.min(luminance(foreground), luminance(background))
  return (light + 0.05) / (dark + 0.05)
}

const themes = {
  dark: tokens(block(':root')),
  light: tokens(block(":root[data-theme='light']")),
  'high-contrast': tokens(block(":root[data-theme='high-contrast']")),
  fallback: tokens(block(':root:not([data-theme])')),
}

describe('theme stylesheet', () => {
  it('is exported and preserved as a side effect', () => {
    expect(pkg.exports['./theme']).toBe('./src/theme.ts')
    expect(pkg.exports['./theme.css']).toBe('./src/theme.css')
    expect(pkg.sideEffects).toContain('**/*.css')
  })

  it('defines every color token in every theme', () => {
    for (const [name, theme] of Object.entries(themes)) {
      for (const token of COLOR_TOKENS) {
        expect(theme.get(token), `${name} is missing --exo-${token}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('defines the shared typography and radius tokens', () => {
    for (const token of SHARED_TOKENS) {
      expect(themes.dark.get(token), `missing --exo-${token}`).toBeTruthy()
    }
  })

  it('uses the same light palette before and after the handshake', () => {
    for (const token of COLOR_TOKENS) {
      expect(themes.fallback.get(token)).toBe(themes.light.get(token))
    }
  })

  it('declares the matching color-scheme for native controls', () => {
    expect(css).toContain('color-scheme: dark')
    expect(css).toContain('color-scheme: light')
    expect(css).toContain(":root[data-theme='high-contrast']")
    expect(css).toContain('@media (prefers-color-scheme: light)')
  })

  it('keeps text pairs at WCAG AA contrast', () => {
    const pairs = [
      ['fg', 'bg'],
      ['muted-fg', 'bg'],
      ['fg', 'surface'],
      ['muted-fg', 'surface'],
      ['accent-fg', 'accent'],
      ['accent-fg', 'accent-hover'],
      ['link', 'bg'],
      ['danger', 'bg'],
      ['warning', 'bg'],
      ['success', 'bg'],
      ['input-fg', 'input-bg'],
      ['selection-fg', 'selection-bg'],
    ] as const
    for (const [name, theme] of Object.entries(themes)) {
      for (const [foreground, background] of pairs) {
        const ratio = contrast(theme.get(foreground) as string, theme.get(background) as string)
        expect(ratio, `${name}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps the focus ring at non-text contrast', () => {
    for (const [name, theme] of Object.entries(themes)) {
      for (const background of ['bg', 'surface']) {
        const ratio = contrast(theme.get('focus') as string, theme.get(background) as string)
        expect(ratio, `${name}: focus on ${background}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
