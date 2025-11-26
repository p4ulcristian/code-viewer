const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let ptyServer;

// Determine if we're in development or production
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'NS Visualizer',
  });

  if (isDev) {
    // In development, load from Vite dev server
    // Try default port first, then fallback
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadURL('http://localhost:5174');
    });
    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startPtyServer() {
  // Start the PTY server
  const serverPath = path.join(__dirname, '../server/pty-server.ts');

  // Use tsx to run TypeScript directly
  ptyServer = spawn('npx', ['tsx', serverPath], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });

  ptyServer.on('error', (err) => {
    console.error('Failed to start PTY server:', err);
  });

  ptyServer.on('exit', (code) => {
    console.log('PTY server exited with code:', code);
  });
}

app.whenReady().then(() => {
  startPtyServer();

  // Give PTY server a moment to start
  setTimeout(() => {
    createWindow();
  }, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Kill PTY server when app closes
  if (ptyServer) {
    ptyServer.kill();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (ptyServer) {
    ptyServer.kill();
  }
});
