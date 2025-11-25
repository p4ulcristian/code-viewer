import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { graphData } from "./graph-data";

const categoryColors: Record<string, string> = {
  features: "#3b82f6",
  "features.common": "#3b82f6",
  "features.customizer": "#8b5cf6",
  "features.flex": "#10b981",
  "features.labs": "#f59e0b",
  schemas: "#ef4444",
  zero: "#6366f1",
  authentication: "#ec4899",
  database: "#14b8a6",
  ui: "#f97316",
  router: "#84cc16",
  parquery: "#06b6d4",
  app: "#a855f7",
  users: "#0ea5e9",
  validation: "#64748b",
  email: "#f43f5e",
  "demo-data": "#78716c",
  other: "#6b7280",
};

// Build node lookup by id
const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));

// Build hierarchy: get namespace at specific depth
function getNsAtDepth(ns: string, depth: number): string {
  const parts = ns.split(".");
  return parts.slice(0, depth).join(".");
}

// Get all unique namespace prefixes at a given depth
function getNamespacesAtDepth(depth: number): Map<string, typeof graphData.nodes> {
  const groups = new Map<string, typeof graphData.nodes>();

  graphData.nodes.forEach((node) => {
    const prefix = getNsAtDepth(node.id, depth);
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(node);
  });

  return groups;
}

// Compute positions for groups in a horizontal line
function computeGroupPositions(groups: Map<string, typeof graphData.nodes>, spacing: number = 25) {
  const result: Array<{
    id: string;
    position: { x: number; y: number; z: number };
    count: number;
    color: string;
    file: string | null; // File path if this is a single-file namespace
  }> = [];
  const entries = Array.from(groups.entries());
  const numGroups = entries.length;

  // Center the line around origin
  const totalWidth = (numGroups - 1) * spacing;
  const startX = -totalWidth / 2;

  entries.forEach(([prefix, nodes], idx) => {
    const x = startX + idx * spacing;

    const color = categoryColors[prefix] || categoryColors[prefix.split(".")[0]] || categoryColors.other;

    // If this group has exactly 1 node with a file, it's a real file namespace
    const singleNode = nodes.length === 1 ? nodes[0] : null;
    const file = singleNode ? (singleNode as any).file || null : null;

    result.push({
      id: prefix,
      position: { x, y: 0, z: 0 },
      count: nodes.length,
      color,
      file,
    });
  });

  return result;
}

// Get child namespaces of a given prefix
function getChildNamespaces(prefix: string, depth: number): Map<string, typeof graphData.nodes> {
  const groups = new Map<string, typeof graphData.nodes>();

  graphData.nodes.forEach((node) => {
    if (node.id.startsWith(prefix + ".") || node.id === prefix) {
      const childPrefix = getNsAtDepth(node.id, depth);
      if (childPrefix.startsWith(prefix)) {
        if (!groups.has(childPrefix)) {
          groups.set(childPrefix, []);
        }
        groups.get(childPrefix)!.push(node);
      }
    }
  });

  return groups;
}

// Get edges between groups
function getEdgesBetweenGroups(groups: string[]): Array<{ source: string; target: string }> {
  const edges: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();

  graphData.edges.forEach((edge) => {
    let sourceGroup: string | null = null;
    let targetGroup: string | null = null;

    for (const g of groups) {
      if (edge.source.startsWith(g + ".") || edge.source === g) {
        sourceGroup = g;
      }
      if (edge.target.startsWith(g + ".") || edge.target === g) {
        targetGroup = g;
      }
    }

    if (sourceGroup && targetGroup && sourceGroup !== targetGroup) {
      const key = `${sourceGroup}->${targetGroup}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ source: sourceGroup, target: targetGroup });
      }
    }
  });

  return edges;
}

interface GroupNodeProps {
  id: string;
  position: { x: number; y: number; z: number };
  count: number;
  color: string;
  isSelected: boolean;
  onClick: () => void;
  file: string | null; // Single file for this namespace (if it's a real file)
  code: string | null; // Pre-loaded code content
}

function GroupNode({ id, position, count, color, isSelected, onClick, file, code }: GroupNodeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const size = Math.max(1, Math.log(count + 1) * 1.5);

  // Only show code panel if this namespace has a real file
  const hasFile = file && code;

  // Bring selected node forward so it's not overlapped
  const zOffset = isSelected ? 30 : 0;

  return (
    <group position={[position.x, position.y, position.z + zOffset]}>
      <mesh ref={meshRef} onClick={onClick}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={isSelected ? "#fbbf24" : color}
          emissive={isSelected ? "#fbbf24" : color}
          emissiveIntensity={isSelected ? 0.3 : 0.1}
        />
      </mesh>
      <Text
        position={[0, size + 1.5, 0]}
        fontSize={2}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.1}
        outlineColor="#000000"
      >
        {id}
      </Text>
      <Text
        position={[0, size + 3.5, 0]}
        fontSize={1.2}
        color="#94a3b8"
        anchorX="center"
        anchorY="middle"
      >
        {hasFile ? file!.split("/").pop() : `${count} ns`}
      </Text>

      {/* Show code panel below if this is a real file */}
      {hasFile && (
        <CodePanel3D
          nsId={id}
          filePath={file!}
          code={code!}
          position={{ x: 0, y: 0, z: 0 }}
        />
      )}
    </group>
  );
}

function GroupEdges({ edges, nodePositions }: {
  edges: Array<{ source: string; target: string }>;
  nodePositions: Map<string, { x: number; y: number; z: number }>;
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [];

    edges.forEach((edge) => {
      const sourcePos = nodePositions.get(edge.source);
      const targetPos = nodePositions.get(edge.target);
      if (sourcePos && targetPos) {
        positions.push(sourcePos.x, sourcePos.y, sourcePos.z);
        positions.push(targetPos.x, targetPos.y, targetPos.z);
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [edges, nodePositions]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#475569" opacity={0.4} transparent linewidth={1} />
    </lineSegments>
  );
}

interface SceneProps {
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  fileContents: Map<string, string>; // Pre-loaded file contents
  cameraTarget: { x: number; y: number; z: number } | null;
  onCameraTargetChange: (target: { x: number; y: number; z: number } | null) => void;
}

// Camera controller that moves camera in front of target
function CameraController({ target, panelWidth }: { target: { x: number; y: number; z: number } | null; panelWidth: number }) {
  const { camera, size, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const prevTargetRef = useRef<string | null>(null);
  const animationRef = useRef<number | null>(null);

  // Handle scroll for panning (shift+scroll or horizontal) and zoom (ctrl+scroll or pinch)
  useEffect(() => {
    const canvas = gl.domElement;

    const handleWheel = (e: WheelEvent) => {
      if (!controlsRef.current) return;

      // Ctrl+scroll or pinch = zoom (let OrbitControls handle it)
      if (e.ctrlKey || e.metaKey) {
        return; // Don't prevent default, let OrbitControls zoom
      }

      // Regular scroll = pan
      e.preventDefault();
      const panSpeed = 0.5;

      // Get camera's right and up vectors for proper panning
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      camera.matrix.extractBasis(right, up, new THREE.Vector3());

      // Pan based on scroll delta
      const deltaX = e.deltaX * panSpeed;
      const deltaY = e.deltaY * panSpeed;

      camera.position.addScaledVector(right, deltaX);
      camera.position.addScaledVector(up, -deltaY);
      controlsRef.current.target.addScaledVector(right, deltaX);
      controlsRef.current.target.addScaledVector(up, -deltaY);
      controlsRef.current.update();
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [gl, camera]);

  useEffect(() => {
    if (!controlsRef.current) return;

    // Serialize target to compare - only animate if target actually changed
    const targetKey = target ? `${target.x},${target.y},${target.z}` : null;
    if (targetKey === prevTargetRef.current) return;
    prevTargetRef.current = targetKey;

    // Cancel any ongoing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    let targetPos: THREE.Vector3;
    let cameraPos: THREE.Vector3;

    if (target) {
      targetPos = new THREE.Vector3(target.x, target.y, target.z);

      // Calculate distance needed to fit panel width in viewport
      const vFov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const aspect = size.width / size.height;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const distance = (panelWidth / 2) / Math.tan(hFov / 2) / 0.85;

      cameraPos = new THREE.Vector3(target.x, target.y, target.z + distance);
    } else {
      // Reset to original camera position
      targetPos = new THREE.Vector3(0, 0, 0);
      cameraPos = new THREE.Vector3(0, 60, 80);
    }

    // Animate camera to new position
    const startPos = camera.position.clone();
    const startTarget = controlsRef.current.target.clone();
    let progress = 0;

    const animate = () => {
      progress += 0.05;
      if (progress >= 1) {
        camera.position.copy(cameraPos);
        controlsRef.current.target.copy(targetPos);
        controlsRef.current.update();
        animationRef.current = null;
        return;
      }

      camera.position.lerpVectors(startPos, cameraPos, progress);
      controlsRef.current.target.lerpVectors(startTarget, targetPos, progress);
      controlsRef.current.update();
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [target, panelWidth, camera, size]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={true}
      enableZoom={false}
      screenSpacePanning={true}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN
      }}
    />
  );
}

function Scene({ currentPath, onNavigate, fileContents, cameraTarget, onCameraTargetChange }: SceneProps) {
  const depth = currentPath.length + 1;
  const prefix = currentPath.join(".");

  const groups = useMemo(() => {
    if (currentPath.length === 0) {
      return getNamespacesAtDepth(1);
    } else {
      return getChildNamespaces(prefix, depth);
    }
  }, [currentPath, prefix, depth]);

  const groupNodes = useMemo(() => {
    return computeGroupPositions(groups, 40);
  }, [groups]);

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; z: number }>();
    groupNodes.forEach((g) => map.set(g.id, g.position));
    return map;
  }, [groupNodes]);

  const edges = useMemo(() => {
    return getEdgesBetweenGroups(groupNodes.map((g) => g.id));
  }, [groupNodes]);

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const handleClick = useCallback((groupId: string, position: { x: number; y: number; z: number }) => {
    const childGroups = getChildNamespaces(groupId, depth + 1);
    const hasChildren = childGroups.size > 1 ||
      (childGroups.size === 1 && !childGroups.has(groupId));

    // Set camera target to clicked node
    onCameraTargetChange(position);

    if (hasChildren) {
      onNavigate([...currentPath, groupId.split(".").pop()!]);
    } else {
      setSelectedGroup(selectedGroup === groupId ? null : groupId);
    }
  }, [currentPath, depth, onNavigate, selectedGroup, onCameraTargetChange]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[50, 50, 50]} intensity={1} />
      <pointLight position={[-50, -50, -50]} intensity={0.5} />

      {/* Axis helper - Red=X, Green=Y, Blue=Z */}
      <axesHelper args={[100]} />

      {/* Grid on XZ plane */}
      <gridHelper args={[200, 20, "#444444", "#222222"]} />

      <group>
        <GroupEdges edges={edges} nodePositions={nodePositions} />

        {groupNodes.map((group) => (
          <GroupNode
            key={group.id}
            id={group.id}
            position={group.position}
            count={group.count}
            color={group.color}
            isSelected={selectedGroup === group.id}
            onClick={() => handleClick(group.id, group.position)}
            file={group.file}
            code={group.file ? fileContents.get(group.file) || null : null}
          />
        ))}
      </group>

      <CameraController target={cameraTarget} panelWidth={20} />
    </>
  );
}

// Syntax highlighting colors for canvas rendering
const syntaxColors: Record<string, string> = {
  keyword: "#c586c0",
  string: "#ce9178",
  comment: "#6a9955",
  number: "#b5cea8",
  function: "#dcdcaa",
  variable: "#9cdcfe",
  operator: "#d4d4d4",
  punctuation: "#d4d4d4",
  default: "#d4d4d4",
};

// Simple Clojure tokenizer
function tokenizeClojure(code: string): Array<{ text: string; type: string }> {
  const tokens: Array<{ text: string; type: string }> = [];
  const keywords = new Set([
    "ns", "def", "defn", "defn-", "defmacro", "let", "fn", "if", "when", "cond",
    "case", "do", "loop", "recur", "for", "doseq", "dotimes", "while",
    "try", "catch", "finally", "throw", "require", "import", "use",
    "true", "false", "nil", "and", "or", "not"
  ]);

  let i = 0;
  while (i < code.length) {
    // Whitespace
    if (/\s/.test(code[i])) {
      let ws = "";
      while (i < code.length && /\s/.test(code[i])) {
        ws += code[i++];
      }
      tokens.push({ text: ws, type: "default" });
      continue;
    }

    // Comment
    if (code[i] === ";") {
      let comment = "";
      while (i < code.length && code[i] !== "\n") {
        comment += code[i++];
      }
      tokens.push({ text: comment, type: "comment" });
      continue;
    }

    // String
    if (code[i] === '"') {
      let str = code[i++];
      while (i < code.length && code[i] !== '"') {
        if (code[i] === "\\") str += code[i++];
        if (i < code.length) str += code[i++];
      }
      if (i < code.length) str += code[i++];
      tokens.push({ text: str, type: "string" });
      continue;
    }

    // Number
    if (/[0-9]/.test(code[i]) || (code[i] === "-" && /[0-9]/.test(code[i + 1] || ""))) {
      let num = "";
      if (code[i] === "-") num += code[i++];
      while (i < code.length && /[0-9.]/.test(code[i])) {
        num += code[i++];
      }
      tokens.push({ text: num, type: "number" });
      continue;
    }

    // Punctuation
    if ("()[]{}".includes(code[i])) {
      tokens.push({ text: code[i++], type: "punctuation" });
      continue;
    }

    // Keyword (Clojure keywords like :foo)
    if (code[i] === ":") {
      let kw = code[i++];
      while (i < code.length && /[a-zA-Z0-9_\-?!]/.test(code[i])) {
        kw += code[i++];
      }
      tokens.push({ text: kw, type: "keyword" });
      continue;
    }

    // Symbol/identifier
    if (/[a-zA-Z_\-+*/<>=!?]/.test(code[i])) {
      let sym = "";
      while (i < code.length && /[a-zA-Z0-9_\-+*/<>=!?.:]/.test(code[i])) {
        sym += code[i++];
      }
      const type = keywords.has(sym) ? "keyword" : "variable";
      tokens.push({ text: sym, type });
      continue;
    }

    // Other
    tokens.push({ text: code[i++], type: "default" });
  }

  return tokens;
}

// 3D Code panel with canvas texture
function CodePanel3D({
  nsId,
  filePath,
  code,
  position,
}: {
  nsId: string;
  filePath: string;
  code: string;
  position: { x: number; y: number; z: number };
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  // High DPI canvas for sharp text
  const scale = 3;
  const fontSize = 14 * scale;
  const lineHeight = 18 * scale;
  const padding = 20 * scale;
  const headerHeight = 36 * scale;

  const lines = code.split("\n");

  // Calculate canvas size based on content
  const maxLineLength = Math.max(...lines.map(l => l.length), 40);
  const canvasWidth = Math.min(2048 * scale, Math.max(600 * scale, (maxLineLength * fontSize * 0.6) + padding * 2 + 60 * scale));
  const canvasHeight = headerHeight + padding * 2 + lines.length * lineHeight;

  // Render code to canvas
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Header bar
    ctx.fillStyle = "#2d2d2d";
    ctx.fillRect(0, 0, canvasWidth, headerHeight);
    ctx.strokeStyle = "#404040";
    ctx.lineWidth = scale;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(canvasWidth, headerHeight);
    ctx.stroke();

    // Header text
    ctx.font = `bold ${13 * scale}px monospace`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(nsId, padding, headerHeight * 0.65);

    // Border
    ctx.strokeStyle = "#404040";
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(0, 0, canvasWidth, canvasHeight);

    // Render code lines
    ctx.font = `${fontSize}px monospace`;
    let y = headerHeight + padding;

    lines.forEach((line, lineNum) => {
      // Line number
      ctx.fillStyle = "#606060";
      ctx.fillText(String(lineNum + 1).padStart(3), padding, y);

      // Tokenize and render line with syntax highlighting
      const tokens = tokenizeClojure(line);
      let x = padding + 50 * scale;

      tokens.forEach((token) => {
        ctx.fillStyle = syntaxColors[token.type] || syntaxColors.default;
        ctx.fillText(token.text, x, y);
        x += ctx.measureText(token.text).width;
      });

      y += lineHeight;
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    setTexture(tex);

    return () => tex.dispose();
  }, [code, nsId, lines.length, canvasWidth, canvasHeight, fontSize, lineHeight, padding, headerHeight, scale]);

  // Scale the 3D plane based on canvas size
  const baseWidth = 20;
  const planeWidth = baseWidth;
  const planeHeight = (canvasHeight / canvasWidth) * planeWidth;

  // Position below the sphere, offset by half the height so top is at y=-5
  const yOffset = -5 - planeHeight / 2;

  return (
    <mesh
      ref={meshRef}
      position={[0, yOffset, 0]}
    >
      <planeGeometry args={[planeWidth, planeHeight]} />
      {texture && (
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
      )}
    </mesh>
  );
}

// Get all unique file paths from graph data
function getAllFilePaths(): string[] {
  const files = new Set<string>();
  graphData.nodes.forEach((node) => {
    const file = (node as any).file;
    if (file) files.add(file);
  });
  return Array.from(files);
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  // Load all files on mount
  useEffect(() => {
    const loadAllFiles = async () => {
      const paths = getAllFilePaths();
      const contents = new Map<string, string>();

      // Load files in parallel (batch of 10 at a time to avoid overwhelming)
      const batchSize = 10;
      for (let i = 0; i < paths.length; i += batchSize) {
        const batch = paths.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (path) => {
            try {
              const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
              if (response.ok) {
                return { path, code: await response.text() };
              }
            } catch (e) {
              // ignore
            }
            return { path, code: null };
          })
        );
        results.forEach(({ path, code }) => {
          if (code) contents.set(path, code);
        });
      }

      setFileContents(contents);
      setLoading(false);
    };

    loadAllFiles();
  }, []);

  const [cameraTarget, setCameraTarget] = useState<{ x: number; y: number; z: number } | null>(null);

  const handleNavigate = useCallback((path: string[]) => {
    setCurrentPath(path);
  }, []);

  const handleCameraTargetChange = useCallback((target: { x: number; y: number; z: number } | null) => {
    setCameraTarget(target);
  }, []);


  // Get visible child namespaces with their positions for left/right navigation
  const getVisibleNamespacesWithPositions = useCallback(() => {
    const depth = currentPath.length + 1;
    const prefix = currentPath.join(".");

    let groups: Map<string, typeof graphData.nodes>;
    if (currentPath.length === 0) {
      groups = getNamespacesAtDepth(1);
    } else {
      groups = getChildNamespaces(prefix, depth);
    }

    // Compute positions for these groups (same logic as computeGroupPositions)
    const entries = Array.from(groups.entries());
    const numGroups = entries.length;
    const spacing = 25;
    const totalWidth = (numGroups - 1) * spacing;
    const startX = -totalWidth / 2;

    return entries.map(([nsPrefix], idx) => {
      const x = startX + idx * spacing;
      return { id: nsPrefix, position: { x, y: 0, z: 0 } };
    });
  }, [currentPath]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selected index when path changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [currentPath]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Reset camera to original position
        setCameraTarget(null);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const visibleNodes = getVisibleNamespacesWithPositions();
        if (visibleNodes.length === 0) return;

        let newIndex: number;
        if (e.key === "ArrowLeft") {
          newIndex = (selectedIndex - 1 + visibleNodes.length) % visibleNodes.length;
        } else {
          newIndex = (selectedIndex + 1) % visibleNodes.length;
        }

        setSelectedIndex(newIndex);

        // Set camera target to the selected node's position
        const node = visibleNodes[newIndex];
        setCameraTarget(node.position);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPath, getVisibleNamespacesWithPositions, selectedIndex]);

  return (
    <div
      style={{ width: "100vw", height: "100vh", background: "#0f172a" }}
    >
      {/* Breadcrumb */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setCurrentPath([])}
          style={{
            background: currentPath.length === 0 ? "#3b82f6" : "rgba(255,255,255,0.1)",
            color: "white",
            border: "none",
            borderRadius: "4px",
            padding: "6px 10px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          root
        </button>
        {currentPath.map((part, idx) => (
          <span key={idx} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ color: "#64748b" }}>/</span>
            <button
              onClick={() => setCurrentPath(currentPath.slice(0, idx + 1))}
              style={{
                background: idx === currentPath.length - 1 ? "#3b82f6" : "rgba(255,255,255,0.1)",
                color: "white",
                border: "none",
                borderRadius: "4px",
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              {part}
            </button>
          </span>
        ))}
      </div>

      {loading && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "rgba(0,0,0,0.8)",
          color: "white",
          padding: "16px 24px",
          borderRadius: "8px",
          zIndex: 2000,
        }}>
          Loading...
        </div>
      )}

      <Canvas camera={{ position: [0, 60, 80], fov: 50 }}>
        <Scene
          currentPath={currentPath}
          onNavigate={handleNavigate}
          fileContents={fileContents}
          cameraTarget={cameraTarget}
          onCameraTargetChange={handleCameraTargetChange}
        />
      </Canvas>
    </div>
  );
}
