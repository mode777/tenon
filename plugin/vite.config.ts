import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The deployed Tenon plugin lives at https://<owner>.github.io/tenon/.
// Development keeps the root base so the local plugin server stays simple.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tenon/' : '/',
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    cors: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: [
        'plugin.html',
        'editors/project.html',
        'editors/schema.html',
        'editors/scene.html',
        'views/project.html',
        'views/inspector.html',
        'views/inspection.html',
      ],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}))
