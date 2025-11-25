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

// Compute positions for groups in a circle
function computeGroupPositions(groups: Map<string, typeof graphData.nodes>, radius: number = 40) {
  const result: Array<{
    id: string;
    position: { x: number; y: number; z: number };
    count: number;
    color: string;
    file: string | null; // File path if this is a single-file namespace
  }> = [];
  const entries = Array.from(groups.entries());
  const numGroups = entries.length;

  entries.forEach(([prefix, nodes], idx) => {
    const angle = (2 * Math.PI * idx) / numGroups;
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);

    const color = categoryColors[prefix] || categoryColors[prefix.split(".")[0]] || categoryColors.other;

    // If this group has exactly 1 node with a file, it's a real file namespace
    const singleNode = nodes.length === 1 ? nodes[0] : null;
    const file = singleNode ? (singleNode as any).file || null : null;

    result.push({
      id: prefix,
      position: { x, y: 0, z },
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

      {/* Show code panel below only for selected node */}
      {hasFile && isSelected && (
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
  yOffset: number;
  onNodeClick: (position: { x: number; y: number; z: number }) => void;
}

// Camera controller that moves camera in front of target, fitting panel to viewport
function CameraController({ target, panelWidth }: { target: { x: number; y: number; z: number } | null; panelWidth: number }) {
  const { camera, size } = useThree();
  const controlsRef = useRef<any>(null);
  const targetPos = useRef(new THREE.Vector3(0, 0, 0));
  const cameraPos = useRef(new THREE.Vector3(0, 60, 80));

  useEffect(() => {
    if (target) {
      // Set target exactly on the node
      targetPos.current.set(target.x, target.y, target.z);

      // Calculate distance needed to fit panel width in viewport
      // Using horizontal FOV: hFov = 2 * atan(tan(vFov/2) * aspect)
      const vFov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
      const aspect = size.width / size.height;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

      // Distance = (panelWidth / 2) / tan(hFov / 2)
      // Add some padding (0.9 to leave 10% margin on each side)
      const distance = (panelWidth / 2) / Math.tan(hFov / 2) / 0.85;

      // Position camera directly in front
      cameraPos.current.set(target.x, target.y, target.z + distance);
    }
  }, [target, panelWidth, camera, size]);

  useFrame(() => {
    if (controlsRef.current) {
      // Smoothly interpolate camera position and target
      camera.position.lerp(cameraPos.current, 0.05);
      controlsRef.current.target.lerp(targetPos.current, 0.05);
      controlsRef.current.update();
    }
  });

  return <OrbitControls ref={controlsRef} makeDefault enablePan={false} enableZoom={false} />;
}

function Scene({ currentPath, onNavigate, fileContents, yOffset, onNodeClick }: SceneProps) {
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
    groupNodes.forEach((g) => map.set(g.id, { ...g.position, y: g.position.y + yOffset }));
    return map;
  }, [groupNodes, yOffset]);

  const edges = useMemo(() => {
    return getEdgesBetweenGroups(groupNodes.map((g) => g.id));
  }, [groupNodes]);

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [cameraTarget, setCameraTarget] = useState<{ x: number; y: number; z: number } | null>(null);

  const handleClick = useCallback((groupId: string, position: { x: number; y: number; z: number }) => {
    const childGroups = getChildNamespaces(groupId, depth + 1);
    const hasChildren = childGroups.size > 1 ||
      (childGroups.size === 1 && !childGroups.has(groupId));

    // Set camera target to clicked node
    const targetPos = { x: position.x, y: position.y + yOffset, z: position.z };
    setCameraTarget(targetPos);
    onNodeClick(targetPos);

    if (hasChildren) {
      onNavigate([...currentPath, groupId.split(".").pop()!]);
    } else {
      setSelectedGroup(selectedGroup === groupId ? null : groupId);
    }
  }, [currentPath, depth, onNavigate, selectedGroup, yOffset, onNodeClick]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[50, 50, 50]} intensity={1} />
      <pointLight position={[-50, -50, -50]} intensity={0.5} />

      {/* Axis helper - Red=X, Green=Y, Blue=Z */}
      <axesHelper args={[100]} />

      {/* Grid on XZ plane */}
      <gridHelper args={[200, 20, "#444444", "#222222"]} />

      {/* Wrap everything in a group that moves with yOffset */}
      <group position={[0, yOffset, 0]}>
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

  const [yOffset, setYOffset] = useState(0);

  const handleNavigate = useCallback((path: string[]) => {
    setCurrentPath(path);
  }, []);

  const handleBack = useCallback(() => {
    setCurrentPath((prev) => prev.slice(0, -1));
  }, []);

  const handleNodeClick = useCallback((_position: { x: number; y: number; z: number }) => {
    // Could be used for additional logic when node is clicked
  }, []);

  // Handle scroll to move Y offset
  const handleWheel = useCallback((e: React.WheelEvent) => {
    setYOffset((prev) => prev - e.deltaY * 0.1);
  }, []);

  return (
    <div
      style={{ width: "100vw", height: "100vh", background: "#0f172a" }}
      onWheel={handleWheel}
    >
      {/* Control Panel */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          zIndex: 1000,
          background: "white",
          padding: "16px",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          maxWidth: "350px",
        }}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: "14px" }}>
          Namespace Explorer
        </h3>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          marginBottom: "12px",
          fontSize: "12px",
          flexWrap: "wrap",
        }}>
          <button
            onClick={() => setCurrentPath([])}
            style={{
              background: currentPath.length === 0 ? "#3b82f6" : "#e2e8f0",
              color: currentPath.length === 0 ? "white" : "#475569",
              border: "none",
              borderRadius: "4px",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            root
          </button>
          {currentPath.map((part, idx) => (
            <span key={idx} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ color: "#94a3b8" }}>/</span>
              <button
                onClick={() => setCurrentPath(currentPath.slice(0, idx + 1))}
                style={{
                  background: idx === currentPath.length - 1 ? "#3b82f6" : "#e2e8f0",
                  color: idx === currentPath.length - 1 ? "white" : "#475569",
                  border: "none",
                  borderRadius: "4px",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: "11px",
                }}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {currentPath.length > 0 && (
          <button
            onClick={handleBack}
            style={{
              background: "#64748b",
              color: "white",
              border: "none",
              borderRadius: "4px",
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: "12px",
              marginBottom: "12px",
            }}
          >
            ← Back
          </button>
        )}

        <div style={{ fontSize: "11px", color: "#64748b" }}>
          Click a node to drill down • Scroll to move Y
        </div>
        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "8px" }}>
          Y offset: {yOffset.toFixed(1)}
        </div>
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
          yOffset={yOffset}
          onNodeClick={handleNodeClick}
        />
      </Canvas>
    </div>
  );
}
