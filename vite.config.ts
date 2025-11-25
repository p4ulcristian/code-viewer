import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'file-server',
      configureServer(server) {
        server.middlewares.use('/api/file', (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const filePath = url.searchParams.get('path')

          if (!filePath) {
            res.statusCode = 400
            res.end('Missing path parameter')
            return
          }

          // Resolve path relative to ironrainbow project (paths come from clj-kondo as project/...)
          // ironrainbow is sibling of Visele at /home/paul/Work/ironrainbow
          const absolutePath = path.resolve(process.cwd(), '..', '..', 'ironrainbow', filePath)

          // Security: ensure the path is within allowed directories (allow /home/paul/Work)
          const allowedBase = path.resolve(process.cwd(), '..', '..')
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
      }
    }
  ],
})
