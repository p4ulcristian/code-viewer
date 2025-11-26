import { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';

interface Terminal3DProps {
  id: string;
  position?: [number, number, number];
  viewportWidth?: number;
  viewportHeight?: number;
  wsUrl?: string;
  cwd?: string;
  onFocus?: () => void;
  followCamera?: boolean; // If true, terminal sticks to camera viewport
}

// Store for multiple terminal instances
const terminalInstances = new Map<string, {
  container: HTMLDivElement;
  terminal: Terminal;
  ws: WebSocket;
  renderCanvas: HTMLCanvasElement;
  fontSize: number;
}>();

// Font size limits
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 32;
const DEFAULT_FONT_SIZE = 16;

// Load saved font size from localStorage
const FONT_SIZE_STORAGE_KEY = 'ns-visualizer-terminal-font-size';
function getSavedFontSize(): number {
  const saved = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  if (saved) {
    const size = parseInt(saved, 10);
    if (!isNaN(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
      return size;
    }
  }
  return DEFAULT_FONT_SIZE;
}

function saveFontSize(size: number) {
  localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(size));
}

export function Terminal3D({
  id,
  position = [0, 0, 0],
  viewportWidth = 30,
  viewportHeight = 20,
  wsUrl = 'ws://localhost:8765',
  cwd,
  onFocus,
}: Terminal3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [textureReady, setTextureReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const instanceRef = useRef<typeof terminalInstances extends Map<string, infer V> ? V : never>(null);

  useEffect(() => {
    console.log(`[Terminal3D:${id}] Mounting`);

    // Check if instance already exists
    const existing = terminalInstances.get(id);
    if (existing) {
      console.log(`[Terminal3D:${id}] Reusing existing terminal`);
      instanceRef.current = existing;

      // Create texture from existing render canvas
      const tex = new THREE.CanvasTexture(existing.renderCanvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      textureRef.current = tex;
      setTextureReady(true);
      setCanvasSize({ width: existing.renderCanvas.width, height: existing.renderCanvas.height });

      // Focus terminal
      setTimeout(() => {
        const textarea = existing.container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
        if (textarea) {
          textarea.style.pointerEvents = 'auto';
          textarea.focus();
        }
      }, 100);

      return () => {
        console.log(`[Terminal3D:${id}] Unmounting (keeping terminal alive)`);
      };
    }

    // First time initialization for this ID
    console.log(`[Terminal3D:${id}] Creating new terminal, cwd:`, cwd);

    // Terminal dimensions - these need to match PTY server
    const cols = 160;
    const rows = 50;
    const fontSize = getSavedFontSize();
    const charWidth = fontSize * 0.6;
    const charHeight = fontSize * 1.2;
    const containerWidth = Math.ceil(cols * charWidth) + 40;
    const containerHeight = Math.ceil(rows * charHeight) + 20;

    // Create container for xterm
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = `${containerWidth}px`;
    container.style.height = `${containerHeight}px`;
    container.style.overflow = 'hidden';
    container.style.pointerEvents = 'none';
    container.style.opacity = '0.01';
    container.style.zIndex = '-1';
    container.dataset.terminalId = id;
    document.body.appendChild(container);

    const term = new Terminal({
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        cursorAccent: '#1a1a2e',
        selectionBackground: '#3b82f6',
        black: '#1a1a2e',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e0e0e0',
        brightBlack: '#4a5568',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      fontSize,
      fontFamily: 'monospace',
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 1000,
      cols,
      rows,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(container);

    const canvasAddon = new CanvasAddon();
    term.loadAddon(canvasAddon);

    // Setup texture
    const setupTexture = () => {
      const canvases = container.querySelectorAll('.xterm-screen canvas');
      if (canvases.length > 0) {
        const firstCanvas = canvases[0] as HTMLCanvasElement;
        const renderCanvas = document.createElement('canvas');
        renderCanvas.width = firstCanvas.width;
        renderCanvas.height = firstCanvas.height;

        const tex = new THREE.CanvasTexture(renderCanvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        textureRef.current = tex;
        setTextureReady(true);
        setCanvasSize({ width: firstCanvas.width, height: firstCanvas.height });

        // Store the instance
        const instance = { container, terminal: term, ws: ws!, renderCanvas, fontSize };
        terminalInstances.set(id, instance);
        instanceRef.current = instance;

        console.log(`[Terminal3D:${id}] Texture ready:`, renderCanvas.width, 'x', renderCanvas.height);
        return true;
      }
      return false;
    };

    const trySetup = () => {
      if (!setupTexture()) {
        setTimeout(trySetup, 100);
      }
    };
    setTimeout(trySetup, 100);

    // Connect WebSocket with session ID and cwd parameters
    const params = new URLSearchParams();
    params.set('id', id);
    if (cwd) params.set('cwd', cwd);
    const ws = new WebSocket(`${wsUrl}?${params.toString()}`);

    ws.onopen = () => {
      console.log(`[Terminal3D:${id}] WebSocket connected`);
      // Send resize to ensure PTY has correct dimensions
      ws.send(`\x1b[8;${rows};${cols}t`);
      setTimeout(() => {
        const textarea = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
        if (textarea) {
          textarea.style.pointerEvents = 'auto';
          textarea.focus();
        }
      }, 100);
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[31mConnection error\x1b[0m\r\n');
    };

    ws.onclose = () => {
      console.log(`[Terminal3D:${id}] WebSocket closed`);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Temporarily store before texture is ready
    const tempInstance = { container, terminal: term, ws, renderCanvas: null as any };
    instanceRef.current = tempInstance as any;

    return () => {
      console.log(`[Terminal3D:${id}] Unmounting (keeping terminal alive)`);
    };
  }, [id, wsUrl, cwd]);

  // Update texture every frame
  useFrame(() => {
    const instance = instanceRef.current;
    if (!materialRef.current || !instance?.renderCanvas || !instance?.container || !textureRef.current) return;

    const ctx = instance.renderCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, instance.renderCanvas.width, instance.renderCanvas.height);

      const canvases = instance.container.querySelectorAll('.xterm-screen canvas');
      canvases.forEach((canvas) => {
        const c = canvas as HTMLCanvasElement;
        if (c.width > 0 && c.height > 0) {
          ctx.drawImage(c, 0, 0);
        }
      });

      textureRef.current.needsUpdate = true;

      if (materialRef.current.map !== textureRef.current) {
        materialRef.current.map = textureRef.current;
        materialRef.current.color.set('#888888');
        materialRef.current.needsUpdate = true;
      }
    }
  });

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    onFocus?.();
    setTimeout(() => {
      const instance = instanceRef.current;
      const textarea = instance?.container?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.pointerEvents = 'auto';
        textarea.focus();
        console.log(`[Terminal3D:${id}] Focused terminal`);
      }
    }, 10);
  }, [id, onFocus]);

  const handleWheel = useCallback((e: any) => {
    e.stopPropagation();
    const instance = instanceRef.current;
    if (instance?.terminal) {
      // Convert wheel delta to scroll lines (negative delta = scroll up)
      const lines = Math.sign(e.deltaY) * 3;
      instance.terminal.scrollLines(lines);
    }
  }, []);

  // Calculate plane dimensions to fit viewport while preserving aspect ratio
  const paddingFactor = 0.9;
  let planeWidth: number;
  let planeHeight: number;

  if (canvasSize) {
    const canvasAspect = canvasSize.width / canvasSize.height;
    const viewportAspect = viewportWidth / viewportHeight;

    if (canvasAspect > viewportAspect) {
      planeWidth = viewportWidth * paddingFactor;
      planeHeight = planeWidth / canvasAspect;
    } else {
      planeHeight = viewportHeight * paddingFactor;
      planeWidth = planeHeight * canvasAspect;
    }
  } else {
    planeWidth = viewportWidth * paddingFactor;
    planeHeight = viewportHeight * paddingFactor;
  }

  return (
    <group position={position}>
      <mesh ref={meshRef} onPointerDown={handlePointerDown} onWheel={handleWheel}>
        <planeGeometry key={`${planeWidth}-${planeHeight}`} args={[planeWidth, planeHeight]} />
        <meshBasicMaterial ref={materialRef} color="#1a1a2e" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// Export function to focus a specific terminal
export function focusTerminal(id: string) {
  const instance = terminalInstances.get(id);
  if (instance) {
    const textarea = instance.container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.pointerEvents = 'auto';
      textarea.focus();
    }
  }
}

// Export function to change font size for all terminals
export function changeTerminalFontSize(delta: number): number {
  const currentSize = getSavedFontSize();
  const newSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, currentSize + delta));

  if (newSize !== currentSize) {
    saveFontSize(newSize);

    // Update all terminal instances
    terminalInstances.forEach((instance, id) => {
      instance.fontSize = newSize;
      instance.terminal.options.fontSize = newSize;

      // Update container size
      const cols = 160;
      const rows = 50;
      const charWidth = newSize * 0.6;
      const charHeight = newSize * 1.2;
      const containerWidth = Math.ceil(cols * charWidth) + 40;
      const containerHeight = Math.ceil(rows * charHeight) + 20;

      instance.container.style.width = `${containerWidth}px`;
      instance.container.style.height = `${containerHeight}px`;

      console.log(`[Terminal3D:${id}] Font size changed to ${newSize}`);
    });
  }

  return newSize;
}

// Get current font size
export function getTerminalFontSize(): number {
  return getSavedFontSize();
}

// Setup global keyboard handler for font size (Ctrl+Plus/Minus)
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    // Check for Ctrl+Plus or Ctrl+Minus (also handle = for plus without shift)
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '+' || e.key === '=' || e.key === 'Equal') {
        e.preventDefault();
        changeTerminalFontSize(2);
      } else if (e.key === '-' || e.key === 'Minus') {
        e.preventDefault();
        changeTerminalFontSize(-2);
      } else if (e.key === '0') {
        e.preventDefault();
        // Reset to default
        const current = getSavedFontSize();
        changeTerminalFontSize(DEFAULT_FONT_SIZE - current);
      }
    }
  });
}
