import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
      }
    }
  ],
})
