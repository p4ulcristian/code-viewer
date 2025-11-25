import { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
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
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Canvas dimensions for sharp rendering
  const canvasWidth = 1920;
  const canvasHeight = 1280;

  useEffect(() => {
    // Create hidden container for xterm
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = `${canvasWidth}px`;
    container.style.height = `${canvasHeight}px`;
    document.body.appendChild(container);
    containerRef.current = container;

    // Create terminal
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
      fontSize: 16,
      fontFamily: 'JetBrains Mono, Fira Code, Monaco, monospace',
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 1000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(container);
    fitAddon.fit();
    terminalRef.current = term;

    // Connect WebSocket
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Terminal connected');
      // Send initial size
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(`\x1b[8;${dims.rows};${dims.cols}t`);
      }
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = (err) => {
      console.error('Terminal WebSocket error:', err);
      term.write('\r\n\x1b[31mConnection error\x1b[0m\r\n');
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[33mConnection closed\x1b[0m\r\n');
    };

    // Handle terminal input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Create texture from terminal canvas
    const termCanvas = container.querySelector('canvas');
    if (termCanvas) {
      const tex = new THREE.CanvasTexture(termCanvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      setTexture(tex);
    }

    return () => {
      ws.close();
      term.dispose();
      container.remove();
    };
  }, [wsUrl]);

  // Update texture every frame
  useFrame(() => {
    if (texture && containerRef.current) {
      const termCanvas = containerRef.current.querySelector('canvas');
      if (termCanvas) {
        texture.needsUpdate = true;
      }
    }
  });

  // Focus handler - forward keyboard events to terminal
  const handlePointerDown = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.focus();
    }
  }, []);

  return (
    <group position={position}>
      {/* Main terminal panel */}
      <mesh ref={meshRef} onPointerDown={handlePointerDown}>
        <planeGeometry args={[width, height]} />
        {texture ? (
          <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
        ) : (
          <meshBasicMaterial color="#1a1a2e" />
        )}
      </mesh>

      {/* Subtle border */}
      <lineSegments>
        <edgesGeometry
          args={[new THREE.PlaneGeometry(width + 0.1, height + 0.1)]}
        />
        <lineBasicMaterial color="#3b82f6" opacity={0.5} transparent />
      </lineSegments>
    </group>
  );
}
