import { WebSocketServer, WebSocket } from 'ws';
import { spawn, IPty } from 'node-pty';
import { IncomingMessage } from 'http';

const PORT = 8765;

// Store PTY sessions by ID for reconnection
const sessions = new Map<string, {
  pty: IPty;
  buffer: string[]; // Store recent output for replay on reconnect
  cwd: string;
  ws: WebSocket | null;
}>();

const MAX_BUFFER_LINES = 1000;

const wss = new WebSocketServer({ port: PORT });

console.log(`PTY WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  // Parse query string
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get('id');
  const cwd = url.searchParams.get('cwd') || process.env.HOME || '/home';

  if (!sessionId) {
    console.log('Connection rejected: no session ID');
    ws.close();
    return;
  }

  console.log(`Client connected, session: ${sessionId}`);

  // Check if session already exists
  let session = sessions.get(sessionId);

  if (session) {
    console.log(`Reconnecting to existing session: ${sessionId}`);

    // Disconnect old websocket if any
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }

    // Attach new websocket
    session.ws = ws;

    // Replay buffer to client
    if (session.buffer.length > 0) {
      ws.send(session.buffer.join(''));
    }
  } else {
    console.log(`Creating new session: ${sessionId}, cwd: ${cwd}`);

    // Create new PTY
    const shell = '/bin/bash';
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

    console.log(`PTY spawned with PID: ${pty.pid}`);

    session = {
      pty,
      buffer: [],
      cwd,
      ws,
    };
    sessions.set(sessionId, session);

    // Handle PTY output
    pty.onData((data: string) => {
      const s = sessions.get(sessionId);
      if (!s) return;

      // Add to buffer
      s.buffer.push(data);
      // Trim buffer if too long
      while (s.buffer.length > MAX_BUFFER_LINES) {
        s.buffer.shift();
      }

      // Send to client if connected
      if (s.ws && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(data);
      }
    });

    // Handle PTY exit
    pty.onExit(({ exitCode, signal }) => {
      console.log(`PTY ${sessionId} exited with code ${exitCode}, signal: ${signal}`);
      const s = sessions.get(sessionId);
      if (s?.ws && s.ws.readyState === WebSocket.OPEN) {
        s.ws.close();
      }
      sessions.delete(sessionId);
    });
  }

  // Handle messages from client
  ws.on('message', (data: Buffer) => {
    const s = sessions.get(sessionId);
    if (!s) return;

    const msg = data.toString();

    // Handle resize messages
    if (msg.startsWith('\x1b[8;')) {
      const match = msg.match(/\x1b\[8;(\d+);(\d+)t/);
      if (match) {
        const rows = parseInt(match[1], 10);
        const cols = parseInt(match[2], 10);
        s.pty.resize(cols, rows);
        return;
      }
    }

    s.pty.write(msg);
  });

  // Handle client disconnect - DON'T kill the PTY
  ws.on('close', () => {
    console.log(`Client disconnected from session: ${sessionId}`);
    const s = sessions.get(sessionId);
    if (s && s.ws === ws) {
      s.ws = null; // Clear websocket reference but keep PTY alive
    }
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for session ${sessionId}:`, err);
    const s = sessions.get(sessionId);
    if (s && s.ws === ws) {
      s.ws = null;
    }
  });
});

// Cleanup: kill PTYs that have been disconnected for too long (optional)
// For now, PTYs stay alive until they exit naturally or server restarts

// List active sessions endpoint (for debugging)
console.log('Active sessions can be checked in server logs');
