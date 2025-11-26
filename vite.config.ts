import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { createCanvas } from 'canvas'
import { createHighlighter, type Highlighter } from 'shiki'

const execAsync = promisify(exec)

// Shiki highlighter instance (lazily initialized)
let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark'],
      langs: ['clojure', 'javascript', 'typescript', 'json', 'markdown', 'html', 'css', 'python', 'rust', 'go', 'java', 'yaml', 'toml', 'bash', 'sql'],
    })
  }
  return highlighterPromise
}

// Map file extensions to shiki language IDs
function getLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const langMap: Record<string, string> = {
    '.clj': 'clojure',
    '.cljs': 'clojure',
    '.cljc': 'clojure',
    '.edn': 'clojure',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.json': 'json',
    '.md': 'markdown',
    '.html': 'html',
    '.css': 'css',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.sh': 'bash',
    '.bash': 'bash',
    '.sql': 'sql',
  }
  return langMap[ext] || 'text'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-server',
      configureServer(server) {
        // List directories API
        server.middlewares.use('/api/list-dir', (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          let dirPath = url.searchParams.get('path') || os.homedir()

          // Expand ~ to home directory
          if (dirPath.startsWith('~')) {
            dirPath = path.join(os.homedir(), dirPath.slice(1))
          }

          try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true })
            const dirs = entries
              .filter(e => e.isDirectory() && !e.name.startsWith('.'))
              .map(e => ({
                name: e.name,
                path: path.join(dirPath, e.name),
                isDirectory: true,
              }))
              .sort((a, b) => a.name.localeCompare(b.name))

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              current: dirPath,
              parent: path.dirname(dirPath),
              entries: dirs,
            }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'Cannot read directory' }))
          }
        })

        // Read file API (now uses projectPath from query)
        server.middlewares.use('/api/file', (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const filePath = url.searchParams.get('path')
          const projectPath = url.searchParams.get('project')

          if (!filePath) {
            res.statusCode = 400
            res.end('Missing path parameter')
            return
          }

          // If project path is provided, resolve relative to it
          let absolutePath: string
          if (projectPath) {
            absolutePath = path.resolve(projectPath, filePath)
          } else {
            // Fallback to old behavior
            absolutePath = path.resolve(process.cwd(), '..', '..', 'ironrainbow', filePath)
          }

          // Security: ensure the path is within home directory
          const allowedBase = os.homedir()
          if (!absolutePath.startsWith(allowedBase)) {
            res.statusCode = 403
            res.end('Access denied')
            return
          }

          try {
            const content = fs.readFileSync(absolutePath, 'utf-8')
            res.setHeader('Content-Type', 'text/plain')
            res.end(content)
          } catch (e) {
            res.statusCode = 404
            res.end(`File not found: ${filePath}`)
          }
        })

        // File tree API - returns hierarchical structure of files/folders
        server.middlewares.use('/api/file-tree', (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const projectPath = url.searchParams.get('project')
          const relativePath = url.searchParams.get('path') || ''

          if (!projectPath) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing project parameter' }))
            return
          }

          // Security: ensure the path is within home directory
          const allowedBase = os.homedir()
          if (!projectPath.startsWith(allowedBase)) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Access denied' }))
            return
          }

          const fullPath = path.join(projectPath, relativePath)

          // Security: ensure resolved path is still within project
          const resolvedPath = path.resolve(fullPath)
          if (!resolvedPath.startsWith(projectPath)) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Access denied' }))
            return
          }

          try {
            const entries = fs.readdirSync(resolvedPath, { withFileTypes: true })

            // Filter out hidden files and common non-code directories
            const skipDirs = new Set(['.git', 'node_modules', '.clj-kondo', 'target', '.cpcache', '.lsp', '.nrepl-port', '.shadow-cljs'])

            const items = entries
              .filter(e => !e.name.startsWith('.') && !skipDirs.has(e.name))
              .map(e => ({
                name: e.name,
                path: path.join(relativePath, e.name),
                isDirectory: e.isDirectory(),
              }))
              .sort((a, b) => {
                // Directories first, then alphabetically
                if (a.isDirectory && !b.isDirectory) return -1
                if (!a.isDirectory && b.isDirectory) return 1
                return a.name.localeCompare(b.name)
              })

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              path: relativePath,
              items,
            }))
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Cannot read directory' }))
          }
        })

        // Run clj-kondo API
        server.middlewares.use('/api/clj-kondo', async (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const projectPath = url.searchParams.get('project')

          if (!projectPath) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing project parameter' }))
            return
          }

          // Security: ensure the path is within home directory
          const allowedBase = os.homedir()
          if (!projectPath.startsWith(allowedBase)) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Access denied' }))
            return
          }

          try {
            // Run clj-kondo with EDN output for easy parsing
            const { stdout, stderr } = await execAsync(
              'clj-kondo --lint src --output "{:output {:format :json}}"',
              { cwd: projectPath, maxBuffer: 10 * 1024 * 1024 }
            )

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              success: true,
              output: stdout,
              errors: stderr
            }))
          } catch (e: any) {
            // clj-kondo returns non-zero exit code when it finds issues
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              success: true,
              output: e.stdout || '',
              errors: e.stderr || e.message
            }))
          }
        })

        // File preview API - renders syntax-highlighted code as PNG image
        server.middlewares.use('/api/file-preview', async (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const filePath = url.searchParams.get('path')
          const projectPath = url.searchParams.get('project')
          const maxLines = parseInt(url.searchParams.get('lines') || '60', 10)

          if (!filePath || !projectPath) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing path or project parameter' }))
            return
          }

          // Security: ensure the path is within home directory
          const allowedBase = os.homedir()
          if (!projectPath.startsWith(allowedBase)) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Access denied' }))
            return
          }

          const absolutePath = path.resolve(projectPath, filePath)
          if (!absolutePath.startsWith(projectPath)) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Access denied' }))
            return
          }

          try {
            const startTime = Date.now()
            const content = fs.readFileSync(absolutePath, 'utf-8')
            const lines = content.split('\n').slice(0, maxLines)
            const truncatedContent = lines.join('\n')
            const readTime = Date.now()

            // Get language from file extension
            const lang = getLanguageFromPath(filePath)

            // Get syntax-highlighted tokens
            const highlighter = await getHighlighter()
            const highlighterTime = Date.now()
            const tokens = highlighter.codeToTokens(truncatedContent, {
              lang: lang === 'text' ? 'javascript' : lang, // fallback for unknown
              theme: 'github-dark',
            })
            const tokenTime = Date.now()

            // Canvas settings - use 3x scale for HiDPI sharp text
            const scale = 3
            const baseFontSize = 14
            const fontSize = baseFontSize * scale
            const lineHeight = fontSize * 1.4
            const padding = 20 * scale
            const charWidth = fontSize * 0.6

            // Calculate canvas dimensions - fixed width for consistency
            const fixedLineWidth = 120 // characters
            const canvasWidth = Math.ceil(fixedLineWidth * charWidth + padding * 2)
            const canvasHeight = Math.ceil(lines.length * lineHeight + padding * 2)

            // Create canvas
            const canvas = createCanvas(canvasWidth, canvasHeight)
            const ctx = canvas.getContext('2d')

            // Background (matching github-dark theme)
            ctx.fillStyle = '#0d1117'
            ctx.fillRect(0, 0, canvasWidth, canvasHeight)

            // Set font
            ctx.font = `${fontSize}px monospace`
            ctx.textBaseline = 'top'

            // Render each line with syntax highlighting
            let y = padding
            for (const line of tokens.tokens) {
              let x = padding
              for (const token of line) {
                ctx.fillStyle = token.color || '#e6edf3'
                ctx.fillText(token.content, x, y)
                x += token.content.length * charWidth
              }
              y += lineHeight
            }

            const renderTime = Date.now()

            // Convert to PNG buffer
            const buffer = canvas.toBuffer('image/png')
            const pngTime = Date.now()

            console.log(`[file-preview] ${filePath}: read=${readTime - startTime}ms, highlighter=${highlighterTime - readTime}ms, tokens=${tokenTime - highlighterTime}ms, render=${renderTime - tokenTime}ms, png=${pngTime - renderTime}ms, total=${pngTime - startTime}ms`)

            res.setHeader('Content-Type', 'image/png')
            res.setHeader('Cache-Control', 'public, max-age=60')
            res.end(buffer)
          } catch (e: any) {
            console.error('File preview error:', e)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message || 'Failed to generate preview' }))
          }
        })
      }
    }
  ],
})
