import { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';

interface Terminal3DProps {
  position?: [number, number, number];
  width?: number;
  height?: number;
  wsUrl?: string;
}

export function Terminal3D({
  position = [0, 0, 0],
  width = 30,
  height = 20,
  wsUrl = 'ws://localhost:8765',
}: Terminal3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [textureReady, setTextureReady] = useState(false);

  useEffect(() => {
    console.log('[Terminal3D] Mounting');

    // Create container for xterm
    // Must be visible in viewport for canvas to render properly
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '1920px';
    container.style.height = '1280px';
    container.style.overflow = 'hidden';
    container.style.pointerEvents = 'none';
    container.style.opacity = '0.01'; // Nearly invisible but still renders
    container.style.zIndex = '-1';
    document.body.appendChild(container);
    containerRef.current = container;

    const cols = 160;
    const rows = 50;

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
      fontSize: 20,
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

    // Load canvas addon for texture rendering
    const canvasAddon = new CanvasAddon();
    term.loadAddon(canvasAddon);

    term.write('Connecting to PTY server...\r\n');

    // Setup texture after canvas is ready
    const setupTexture = () => {
      const canvases = container.querySelectorAll('.xterm-screen canvas');
      if (canvases.length > 0) {
        const firstCanvas = canvases[0] as HTMLCanvasElement;
        const renderCanvas = document.createElement('canvas');
        renderCanvas.width = firstCanvas.width;
        renderCanvas.height = firstCanvas.height;
        renderCanvasRef.current = renderCanvas;

        const tex = new THREE.CanvasTexture(renderCanvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        textureRef.current = tex;
        setTextureReady(true);
        console.log('[Terminal3D] Texture ready:', renderCanvas.width, 'x', renderCanvas.height);
        return true;
      }
      return false;
    };

    // Retry until canvas is available
    const trySetup = () => {
      if (!setupTexture()) {
        setTimeout(trySetup, 100);
      }
    };
    setTimeout(trySetup, 100);

    // Connect WebSocket
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Terminal3D] WebSocket connected');
      term.write('\x1b[2K\rConnected!\r\n');
      ws.send(`\x1b[8;${rows};${cols}t`);
      // Focus terminal and enable pointer events on textarea
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
      console.log('[Terminal3D] WebSocket closed');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    return () => {
      console.log('[Terminal3D] Cleanup');
      ws.close();
      term.dispose();
      container.remove();
    };
  }, [wsUrl]);

  // Update texture every frame
  useFrame(() => {
    if (!materialRef.current || !renderCanvasRef.current || !containerRef.current || !textureRef.current) return;

    const ctx = renderCanvasRef.current.getContext('2d');
    if (ctx) {
      // Clear background
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, renderCanvasRef.current.width, renderCanvasRef.current.height);

      // Composite xterm canvases
      const canvases = containerRef.current.querySelectorAll('.xterm-screen canvas');
      canvases.forEach((canvas) => {
        const c = canvas as HTMLCanvasElement;
        if (c.width > 0 && c.height > 0) {
          ctx.drawImage(c, 0, 0);
        }
      });

      textureRef.current.needsUpdate = true;

      // Apply texture to material
      if (materialRef.current.map !== textureRef.current) {
        materialRef.current.map = textureRef.current;
        materialRef.current.color.set('#888888'); // Dimmed to match scene
        materialRef.current.needsUpdate = true;
      }
    }
  });

  // Click to focus
  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    // Need a small delay to ensure the click doesn't get eaten
    setTimeout(() => {
      const textarea = containerRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.pointerEvents = 'auto';
        textarea.focus();
        console.log('[Terminal3D] Focused terminal');
      }
    }, 10);
  }, []);

  return (
    <group position={position}>
      <mesh ref={meshRef} onPointerDown={handlePointerDown}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={materialRef} color="#1a1a2e" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
