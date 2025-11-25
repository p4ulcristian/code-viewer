import { WebSocketServer, WebSocket } from 'ws';
import { spawn, IPty } from 'node-pty';
import { IncomingMessage } from 'http';

const PORT = 8765;

const wss = new WebSocketServer({ port: PORT });

console.log(`PTY WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  console.log('Client connected');

  // Parse cwd from query string
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const cwd = url.searchParams.get('cwd') || process.env.HOME || '/home';
  console.log('Working directory:', cwd);

  // Use bash with login shell to get proper environment
  const shell = '/bin/bash';
  console.log('Spawning shell:', shell);

  const pty: IPty = spawn(shell, ['--login'], {
    name: 'xterm-256color',
    cols: 160,
    rows: 50,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>,
  });

  console.log('PTY spawned with PID:', pty.pid);

  pty.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    console.log(`PTY exited with code ${exitCode}, signal: ${signal}`);
    ws.close();
  });

  ws.on('message', (data: Buffer) => {
    const msg = data.toString();

    // Handle resize messages
    if (msg.startsWith('\x1b[8;')) {
      const match = msg.match(/\x1b\[8;(\d+);(\d+)t/);
      if (match) {
        const rows = parseInt(match[1], 10);
        const cols = parseInt(match[2], 10);
        pty.resize(cols, rows);
        return;
      }
    }

    pty.write(msg);
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    pty.kill();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    pty.kill();
  });
});
