import { WebSocketServer, WebSocket } from 'ws';
import { spawn, IPty } from 'node-pty';

const PORT = 8765;

const wss = new WebSocketServer({ port: PORT });

console.log(`PTY WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  const pty: IPty = spawn('claude', [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: process.env.HOME || '/home',
    env: process.env as Record<string, string>,
  });

  pty.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  pty.onExit(({ exitCode }) => {
    console.log(`PTY exited with code ${exitCode}`);
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
