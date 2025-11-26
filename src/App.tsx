import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { graphData } from "./graph-data";
import { Terminal3D, focusTerminal } from "./components/Terminal3D";
import { ProjectSetup } from "./components/ProjectSetup";
import { HUD3D } from "./components/HUD3D";

const STORAGE_KEY = 'ns-visualizer-project-path';
const TERMINALS_STORAGE_KEY = 'ns-visualizer-terminals';
const NAV_STATE_STORAGE_KEY = 'ns-visualizer-nav-state';

// Navigation state interface
interface NavState {
  showTerminal: boolean;
  activeTerminal: number;
  currentPath: string[];
  selectedGroup: string | null;
  isPanelView: boolean;
}

// Grid system constants
const GRID = {
  CELL_WIDTH: 25,    // X spacing between items
  CELL_HEIGHT: 40,   // Y spacing between levels (not used yet, for future)
  CAMERA_Z: 100,     // Default camera distance
  NODE_COLOR: "#3b82f6",
  NODE_SIZE: 2,
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

// Grid helper: get X position for an item at given index (starts at 0,0 and goes right)
function gridX(index: number): number {
  return index * GRID.CELL_WIDTH;
}

// Grid helper: get position for grid cell
function gridPosition(index: number): { x: number; y: number; z: number } {
  return { x: gridX(index), y: 0, z: 0 };
}

// Compute positions for groups using grid system
function computeGroupPositions(groups: Map<string, typeof graphData.nodes>, currentDepth: number, parentPrefix: string) {
  // Sort entries alphabetically by id
  const entries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return entries.map(([prefix, nodes], idx) => {
    // Only show file if the group ID exactly matches a node ID (it's a leaf namespace)
    const exactMatch = nodes.find(n => n.id === prefix);
    const file = exactMatch ? (exactMatch as any).file || null : null;

    // Get child namespaces (next level) for non-file nodes
    const childGroups = getChildNamespaces(prefix, currentDepth + 1);
    const childNamespaces = Array.from(childGroups.keys())
      .filter(child => child !== prefix) // Exclude self
      .sort()
      .map(child => child.startsWith(prefix + '.') ? child.slice(prefix.length + 1) : child); // Remaining part after prefix

    // Display name: remaining part after parent prefix
    const displayName = parentPrefix && prefix.startsWith(parentPrefix + '.')
      ? prefix.slice(parentPrefix.length + 1)
      : prefix;

    return {
      id: prefix,
      displayName,
      position: gridPosition(idx),
      index: idx,
      color: GRID.NODE_COLOR,
      file,
      childNamespaces,
    };
  });
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
  displayName: string; // Name to display (remaining part of namespace)
  position: { x: number; y: number; z: number };
  color: string;
  isSelected: boolean;
  onClick: () => void;
  file: string | null; // Single file for this namespace (if it's a real file)
  code: string | null; // Pre-loaded code content
  childNamespaces: string[]; // Child namespace names for non-file nodes
  onPanelClick: (panelCenter: { x: number; y: number; z: number }, panelWidth: number) => void;
}

function GroupNode({ id, displayName, position, color, isSelected, onClick, file, code, childNamespaces, onPanelClick }: GroupNodeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const size = 2; // Same size for all

  // Only show code panel if this namespace has a real file
  const hasFile = file && code;

  return (
    <group position={[position.x, position.y, position.z]}>
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
        {displayName}
      </Text>
      {hasFile && (
        <Text
          position={[0, size + 3.5, 0]}
          fontSize={1.2}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
        >
          {file!.split("/").pop()}
        </Text>
      )}

      {/* Show child namespaces list below non-file nodes */}
      {!hasFile && childNamespaces.length > 0 && (
        <group position={[0, -size - 2, 0]}>
          {childNamespaces.map((childNs, idx) => (
            <Text
              key={childNs}
              position={[0, -idx * 1.8, 0]}
              fontSize={1.2}
              color="#94a3b8"
              anchorX="center"
              anchorY="middle"
            >
              {childNs}
            </Text>
          ))}
        </group>
      )}

      {/* Show code panel below if this is a real file */}
      {hasFile && (
        <CodePanel3D
          nsId={id}
          filePath={file!}
          code={code!}
          position={position}
          onPanelClick={onPanelClick}
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
  selectedGroup: string | null;
  onSelectedGroupChange: (group: string | null) => void;
  isPanelView: boolean;
  onPanelViewChange: (isPanelView: boolean) => void;
  showTerminal: boolean;
  onShowTerminalChange: (show: boolean) => void;
  projectPath: string | null;
  terminals: string[]; // List of terminal IDs
  activeTerminal: number; // Index of active terminal
  onAddTerminal: () => void;
  onSelectTerminal: (index: number) => void;
  onCloseTerminal: (index: number) => void;
  onTerminalSpacingChange: (spacing: number) => void;
  skipInitialAnimation?: boolean;
}

// Camera controller that moves camera in front of target
function CameraController({ target, panelWidth, hasFileSelected, scrollBounds, skipInitialAnimation, terminalActive }: {
  target: { x: number; y: number; z: number } | null;
  panelWidth: number;
  hasFileSelected: boolean;
  scrollBounds: { minY: number; maxY: number } | null;
  skipInitialAnimation?: boolean;
  terminalActive?: boolean;
}) {
  const { camera, size, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const prevTargetRef = useRef<string | null>(null);
  const animationRef = useRef<number | null>(null);
  const hasFileSelectedRef = useRef(hasFileSelected);
  const scrollBoundsRef = useRef(scrollBounds);
  const terminalActiveRef = useRef(terminalActive);
  const isFirstRenderRef = useRef(true);
  hasFileSelectedRef.current = hasFileSelected;
  scrollBoundsRef.current = scrollBounds;
  terminalActiveRef.current = terminalActive;

  // Handle scroll for panning (shift+scroll or horizontal) and zoom (ctrl+scroll or pinch)
  useEffect(() => {
    const canvas = gl.domElement;

    const handleWheel = (e: WheelEvent) => {
      if (!controlsRef.current) return;

      // When terminal is active, don't capture scroll - let terminal handle it
      if (terminalActiveRef.current) {
        return;
      }

      // Prevent all zoom (ctrl+scroll, pinch, etc)
      e.preventDefault();

      // Ctrl+scroll = do nothing (no zoom)
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      // Regular scroll = pan
      const panSpeedX = 0.5;
      const panSpeedY = 0.15; // Slower vertical scroll for reading code

      // Get camera's right and up vectors for proper panning
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      camera.matrix.extractBasis(right, up, new THREE.Vector3());

      // When file is selected: only vertical scroll allowed
      // When no file selected: only horizontal scroll allowed
      const deltaX = hasFileSelectedRef.current ? 0 : e.deltaX * panSpeedX;
      let deltaY = hasFileSelectedRef.current ? e.deltaY * panSpeedY : 0;

      // Apply scroll bounds for vertical scrolling
      if (deltaY !== 0 && scrollBoundsRef.current) {
        const bounds = scrollBoundsRef.current;
        const newTargetY = controlsRef.current.target.y - deltaY;

        // Clamp to bounds
        if (newTargetY > bounds.maxY) {
          deltaY = controlsRef.current.target.y - bounds.maxY;
        } else if (newTargetY < bounds.minY) {
          deltaY = controlsRef.current.target.y - bounds.minY;
        }
      }

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
      // Check if this is an "X only" centering (y=0, z=0 means just center horizontally)
      const isXOnlyCenter = target.y === 0 && target.z === 0;

      if (isXOnlyCenter) {
        // Only move X, keep camera at default Z distance looking at the circle
        targetPos = new THREE.Vector3(target.x, 0, 0);
        cameraPos = new THREE.Vector3(target.x, 0, GRID.CAMERA_Z);
      } else {
        targetPos = new THREE.Vector3(target.x, target.y, target.z);

        // Calculate distance needed to fit panel width in viewport
        const vFov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
        const aspect = size.width / size.height;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
        const distance = (panelWidth / 2) / Math.tan(hFov / 2) / 0.85;

        cameraPos = new THREE.Vector3(target.x, target.y, target.z + distance);
      }
    } else {
      // Reset to original camera position - directly in front of the circles
      targetPos = new THREE.Vector3(0, 0, 0);
      cameraPos = new THREE.Vector3(0, 0, GRID.CAMERA_Z);
    }

    // Skip animation on first render if requested
    const shouldSkipAnimation = isFirstRenderRef.current && skipInitialAnimation;
    isFirstRenderRef.current = false;

    if (shouldSkipAnimation) {
      // Set position directly without animation
      camera.position.copy(cameraPos);
      controlsRef.current.target.copy(targetPos);
      controlsRef.current.update();
      return;
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
      enableRotate={false}
      screenSpacePanning={true}
      mouseButtons={{
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN
      }}
    />
  );
}

// 3D Terminal button component with hover and active animations
function TerminalButton({
  position,
  onClick,
  isActive,
  isAddButton = false,
  isCloseButton = false,
  children
}: {
  position: [number, number, number];
  onClick: () => void;
  isActive: boolean;
  isAddButton?: boolean;
  isCloseButton?: boolean;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Animate the button - swing rotation for active
  useFrame((state) => {
    if (!groupRef.current) return;

    if (isActive) {
      // Gentle swing animation (rotate around Y axis)
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 2) * 0.15;
    } else {
      // Reset rotation when not active
      groupRef.current.rotation.y *= 0.9;
    }

    // Scale on hover
    const targetScale = hovered ? 1.15 : 1;
    groupRef.current.scale.setScalar(
      groupRef.current.scale.x + (targetScale - groupRef.current.scale.x) * 0.1
    );
  });

  const baseColor = isCloseButton ? "#ef4444" : (isAddButton ? "#10b981" : (isActive ? "#3b82f6" : "#4b5563"));
  const edgeColor = isCloseButton ? "#b91c1c" : (isAddButton ? "#059669" : (isActive ? "#1d4ed8" : "#1f2937"));

  return (
    <group position={position}>
      <group ref={groupRef}>
        {/* Main button face */}
        <mesh
          position={[0, 0, 0.1]}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <boxGeometry args={[0.85, 0.85, 0.08]} />
          <meshStandardMaterial
            color={baseColor}
            emissive={baseColor}
            emissiveIntensity={isActive ? 0.3 : (hovered ? 0.2 : 0.1)}
            metalness={0.2}
            roughness={0.5}
          />
        </mesh>
        {/* Darker edge/frame */}
        <mesh
          position={[0, 0, 0]}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <boxGeometry args={[0.95, 0.95, 0.15]} />
          <meshStandardMaterial
            color={edgeColor}
            metalness={0.4}
            roughness={0.3}
          />
        </mesh>
        {/* Text on front face - always visible */}
        <Text
          position={[0, 0, 0.15]}
          fontSize={0.35}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {children}
        </Text>
        {/* Glow indicator for active button */}
        {isActive && (
          <pointLight position={[0, 0, 0.3]} intensity={0.5} distance={2} color="#60a5fa" />
        )}
      </group>
    </group>
  );
}

function Scene({ currentPath, onNavigate, fileContents, cameraTarget, onCameraTargetChange, selectedGroup, onSelectedGroupChange, isPanelView, onPanelViewChange, showTerminal, onShowTerminalChange, projectPath, terminals, activeTerminal, onAddTerminal, onSelectTerminal, onCloseTerminal, onTerminalSpacingChange, skipInitialAnimation }: SceneProps) {
  const { camera, size } = useThree();
  const depth = currentPath.length + 1;
  const prefix = currentPath.join(".");
  const prevPositionRef = useRef<{ x: number; y: number; z: number } | null>(null);

  // Calculate terminal viewport size for filling the screen
  // Camera will be positioned to fit panelWidth (20) in view - matches CameraController logic
  const TERMINAL_PANEL_WIDTH = 20; // Panel width used for camera distance calc
  const vFov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
  const aspect = size.width / size.height;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  // Distance camera will be at when viewing terminal (matches CameraController logic)
  const terminalCameraDistance = (TERMINAL_PANEL_WIDTH / 2) / Math.tan(hFov / 2) / 0.85;
  // Viewport dimensions at that distance
  const terminalViewportHeight = 2 * Math.tan(vFov / 2) * terminalCameraDistance;
  const terminalViewportWidth = terminalViewportHeight * aspect;

  // Report terminal spacing to parent
  const calculatedTerminalSpacing = terminalViewportHeight + 5;
  useEffect(() => {
    onTerminalSpacingChange(calculatedTerminalSpacing);
  }, [calculatedTerminalSpacing, onTerminalSpacingChange]);

  const groups = useMemo(() => {
    if (currentPath.length === 0) {
      return getNamespacesAtDepth(1);
    } else {
      return getChildNamespaces(prefix, depth);
    }
  }, [currentPath, prefix, depth]);

  const groupNodes = useMemo(() => {
    return computeGroupPositions(groups, depth, prefix);
  }, [groups, depth, prefix]);

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; z: number }>();
    groupNodes.forEach((g) => map.set(g.id, g.position));
    return map;
  }, [groupNodes]);

  const edges = useMemo(() => {
    return getEdgesBetweenGroups(groupNodes.map((g) => g.id));
  }, [groupNodes]);

  const handleClick = useCallback((groupId: string, position: { x: number; y: number; z: number }, hasFile: boolean) => {
    const childGroups = getChildNamespaces(groupId, depth + 1);
    const hasChildren = childGroups.size > 1 ||
      (childGroups.size === 1 && !childGroups.has(groupId));

    if (hasChildren) {
      // For non-file nodes, reset camera to origin and enter namespace
      onCameraTargetChange({ x: 0, y: 0, z: 0 });
      onNavigate([...currentPath, groupId.split(".").pop()!]);
    } else {
      // For file nodes, center on the full position
      onCameraTargetChange(position);
      onSelectedGroupChange(selectedGroup === groupId ? null : groupId);
    }
    onPanelViewChange(false);
  }, [currentPath, depth, onNavigate, selectedGroup, onCameraTargetChange, onSelectedGroupChange, onPanelViewChange]);

  const handlePanelClick = useCallback((panelCenter: { x: number; y: number; z: number }, panelWidth: number) => {
    if (isPanelView) {
      // Already in panel view, go back to previous position
      if (prevPositionRef.current) {
        onCameraTargetChange(prevPositionRef.current);
      }
      onPanelViewChange(false);
    } else {
      // Save current target and switch to panel view
      prevPositionRef.current = cameraTarget;
      onCameraTargetChange(panelCenter);
      onPanelViewChange(true);
    }
  }, [isPanelView, cameraTarget, onCameraTargetChange, onPanelViewChange]);

  // Compute scroll bounds for selected file
  const scrollBounds = useMemo(() => {
    if (!selectedGroup) return null;
    const group = groupNodes.find(g => g.id === selectedGroup);
    if (!group || !group.file) return null;

    const code = fileContents.get(group.file);
    if (!code) return null;

    // Calculate panel height based on code lines (same logic as CodePanel3D)
    const lines = code.split("\n");
    const scale = 3;
    const lineHeight = 18 * scale;
    const padding = 20 * scale;
    const headerHeight = 36 * scale;
    const canvasWidth = 1200 * scale;
    const canvasHeight = headerHeight + padding * 2 + lines.length * lineHeight;

    const baseWidth = 20;
    const planeHeight = (canvasHeight / canvasWidth) * baseWidth;
    const yOffset = -5 - planeHeight / 2;

    // Bounds: top of panel to bottom of panel
    const topY = yOffset + planeHeight / 2;
    const bottomY = yOffset - planeHeight / 2;

    return { minY: bottomY, maxY: topY };
  }, [selectedGroup, groupNodes, fileContents]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[50, 50, 50]} intensity={1} />
      <pointLight position={[-50, -50, -50]} intensity={0.5} />


      <group>
        {groupNodes.map((group) => (
          <GroupNode
            key={group.id}
            id={group.id}
            displayName={group.displayName}
            position={group.position}
            color={group.color}
            isSelected={selectedGroup === group.id}
            onClick={() => handleClick(group.id, group.position, group.file !== null)}
            file={group.file}
            code={group.file ? fileContents.get(group.file) || null : null}
            childNamespaces={group.childNamespaces}
            onPanelClick={handlePanelClick}
          />
        ))}
      </group>

      <CameraController
        target={cameraTarget}
        panelWidth={20}
        hasFileSelected={selectedGroup !== null && groupNodes.some(g => g.id === selectedGroup && g.file !== null)}
        scrollBounds={scrollBounds}
        skipInitialAnimation={skipInitialAnimation}
        terminalActive={showTerminal}
      />

      {/* 3D HUD - follows camera */}
      <HUD3D
        showTerminal={showTerminal}
        onTerminalClick={() => onShowTerminalChange(true)}
        onWorkspaceClick={() => onShowTerminalChange(false)}
      />

      {/* Terminal panels - each positioned below the previous one */}
      {showTerminal && terminals.map((terminalId, index) => {
        const TERMINAL_SPACING = terminalViewportHeight + 5;
        const yPosition = -index * TERMINAL_SPACING;
        return (
          <Terminal3D
            key={terminalId}
            id={terminalId}
            position={[-80, yPosition, 30]}
            viewportWidth={terminalViewportWidth}
            viewportHeight={terminalViewportHeight}
            cwd={projectPath ?? undefined}
            onFocus={() => onSelectTerminal(index)}
          />
        );
      })}

      {/* Terminal navigation buttons - horizontal, above the terminal */}
      {showTerminal && (() => {
        const TERMINAL_SPACING = terminalViewportHeight + 5;
        const activeY = -activeTerminal * TERMINAL_SPACING;

        // Calculate actual terminal plane dimensions (matching Terminal3D logic)
        // Terminal canvas: 160 cols * 9.6px wide, 50 rows * 19.2px tall (fontSize 16)
        const terminalCanvasWidth = 160 * 9.6 + 40; // cols * charWidth + padding
        const terminalCanvasHeight = 50 * 19.2 + 20; // rows * charHeight + padding
        const canvasAspect = terminalCanvasWidth / terminalCanvasHeight;
        const viewportAspect = terminalViewportWidth / terminalViewportHeight;
        const paddingFactor = 0.9;

        let actualPlaneWidth: number;
        let actualPlaneHeight: number;
        if (canvasAspect > viewportAspect) {
          actualPlaneWidth = terminalViewportWidth * paddingFactor;
          actualPlaneHeight = actualPlaneWidth / canvasAspect;
        } else {
          actualPlaneHeight = terminalViewportHeight * paddingFactor;
          actualPlaneWidth = actualPlaneHeight * canvasAspect;
        }

        // Position above terminal
        const topY = actualPlaneHeight / 2 + 1.2;
        // Align to left edge of terminal
        const terminalLeftEdge = -80 - actualPlaneWidth / 2 + 0.5;

        return (
          <group position={[terminalLeftEdge, activeY + topY, 30]}>
            {/* Add terminal button */}
            <TerminalButton
              position={[0, 0, 0]}
              onClick={onAddTerminal}
              isActive={false}
              isAddButton
            >
              +
            </TerminalButton>

            {/* Terminal number buttons - horizontal row */}
            {terminals.map((_, index) => {
              const xPosition = (index + 1) * 1.2;
              const isActive = index === activeTerminal;
              return (
                <TerminalButton
                  key={index}
                  position={[xPosition, 0, 0]}
                  onClick={() => onSelectTerminal(index)}
                  isActive={isActive}
                >
                  {index + 1}
                </TerminalButton>
              );
            })}

            {/* Close button - on the right side, only if more than 1 terminal */}
            {terminals.length > 1 && (
              <TerminalButton
                position={[actualPlaneWidth - 1, 0, 0]}
                onClick={() => onCloseTerminal(activeTerminal)}
                isActive={false}
                isCloseButton
              >
                ×
              </TerminalButton>
            )}
          </group>
        );
      })()}
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
  onPanelClick,
}: {
  nsId: string;
  filePath: string;
  code: string;
  position: { x: number; y: number; z: number };
  onPanelClick: (panelCenter: { x: number; y: number; z: number }, panelWidth: number) => void;
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

  // Fixed canvas width for consistent font size across all files
  const canvasWidth = 1200 * scale;
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

  const handleClick = (e: any) => {
    e.stopPropagation();
    // Calculate world position of panel center
    onPanelClick({ x: position.x, y: yOffset, z: position.z }, planeWidth);
  };

  return (
    <mesh
      ref={meshRef}
      position={[0, yOffset, 0]}
      onClick={handleClick}
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
  // Project path state - load from localStorage
  const [projectPath, setProjectPath] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY);
  });
  const [showProjectSetup, setShowProjectSetup] = useState(!projectPath);

  const handleProjectSelect = useCallback((path: string) => {
    localStorage.setItem(STORAGE_KEY, path);
    setProjectPath(path);
    setShowProjectSetup(false);
    // Reload page to reinitialize everything with new project
    window.location.reload();
  }, []);

  // Load navigation state from localStorage
  const savedNavState = useMemo(() => {
    const saved = localStorage.getItem(NAV_STATE_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved) as NavState;
      } catch {}
    }
    return null;
  }, []);

  const [currentPath, setCurrentPath] = useState<string[]>(savedNavState?.currentPath ?? []);
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  // Load all files on mount
  useEffect(() => {
    if (!projectPath) {
      setLoading(false);
      return;
    }

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
              const response = await fetch(`/api/file?path=${encodeURIComponent(path)}&project=${encodeURIComponent(projectPath)}`);
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
  }, [projectPath]);

  // clj-kondo results state
  const [kondoResults, setKondoResults] = useState<{ findings: any[]; summary: any } | null>(null);
  const [kondoRunning, setKondoRunning] = useState(false);

  // Run clj-kondo on project start
  useEffect(() => {
    if (!projectPath) return;

    const runKondo = async () => {
      setKondoRunning(true);
      try {
        const response = await fetch(`/api/clj-kondo?project=${encodeURIComponent(projectPath)}`);
        const data = await response.json();
        if (data.output) {
          try {
            const parsed = JSON.parse(data.output);
            setKondoResults(parsed);
            console.log('[clj-kondo] Results:', parsed);
          } catch {
            console.log('[clj-kondo] Raw output:', data.output);
          }
        }
        if (data.errors) {
          console.log('[clj-kondo] Errors:', data.errors);
        }
      } catch (e) {
        console.error('[clj-kondo] Failed to run:', e);
      }
      setKondoRunning(false);
    };

    runKondo();
  }, [projectPath]);

  const [cameraTarget, setCameraTarget] = useState<{ x: number; y: number; z: number } | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(savedNavState?.selectedGroup ?? null);
  const [isPanelView, setIsPanelView] = useState(savedNavState?.isPanelView ?? false);
  const [showTerminal, setShowTerminal] = useState(savedNavState?.showTerminal ?? false);

  // Load terminals from localStorage
  const [terminals, setTerminals] = useState<string[]>(() => {
    const saved = localStorage.getItem(TERMINALS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Filter out any invalid terminal IDs (must match terminal-N pattern)
          const valid = parsed.filter((id: string) => /^terminal-\d+$/.test(id));
          if (valid.length > 0) {
            return valid;
          }
        }
      } catch {}
    }
    return ['terminal-1'];
  });
  const [activeTerminal, setActiveTerminal] = useState(savedNavState?.activeTerminal ?? 0);
  // Initialize counter based on highest existing terminal number
  const terminalCounterRef = useRef(
    terminals.reduce((max, id) => {
      const match = id.match(/terminal-(\d+)/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0)
  );
  const prevCameraTargetRef = useRef<{ x: number; y: number; z: number } | null>(null);

  // Save terminals to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(TERMINALS_STORAGE_KEY, JSON.stringify(terminals));
  }, [terminals]);

  // Save navigation state to localStorage whenever it changes
  useEffect(() => {
    const navState: NavState = {
      showTerminal,
      activeTerminal,
      currentPath,
      selectedGroup,
      isPanelView,
    };
    localStorage.setItem(NAV_STATE_STORAGE_KEY, JSON.stringify(navState));
  }, [showTerminal, activeTerminal, currentPath, selectedGroup, isPanelView]);

  // Terminal base position - z is set to trigger close camera view
  const TERMINAL_BASE_POSITION = { x: -80, y: 0, z: 30 };
  // Terminal spacing - will be set by Scene component
  const [terminalSpacing, setTerminalSpacing] = useState(25);

  const getTerminalPosition = useCallback((index: number) => ({
    x: TERMINAL_BASE_POSITION.x,
    y: -index * terminalSpacing,
    z: TERMINAL_BASE_POSITION.z,
  }), [terminalSpacing]);

  // Set initial camera position based on saved state (after mount)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (showTerminal) {
      // Delay to ensure Scene has set terminalSpacing
      const timer = setTimeout(() => {
        // Use the base position directly since spacing might not be updated yet
        setCameraTarget({
          x: TERMINAL_BASE_POSITION.x,
          y: -activeTerminal * terminalSpacing,
          z: TERMINAL_BASE_POSITION.z,
        });
        // Focus the terminal
        if (terminals[activeTerminal]) {
          focusTerminal(terminals[activeTerminal]);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []); // Run once on mount

  // Update camera when terminalSpacing changes (for initial load when in terminal mode)
  const spacingInitializedRef = useRef(false);
  useEffect(() => {
    if (!showTerminal || spacingInitializedRef.current) return;
    spacingInitializedRef.current = true;

    // Re-position camera with correct spacing
    setCameraTarget(getTerminalPosition(activeTerminal));
  }, [terminalSpacing]);


  const toggleTerminal = useCallback(() => {
    setShowTerminal(prev => {
      if (!prev) {
        // Opening terminal - save current camera and focus on active terminal
        prevCameraTargetRef.current = cameraTarget;
        setCameraTarget(getTerminalPosition(activeTerminal));
      } else {
        // Closing terminal - restore previous camera
        setCameraTarget(prevCameraTargetRef.current);
      }
      return !prev;
    });
  }, [cameraTarget, activeTerminal, getTerminalPosition]);

  const handleAddTerminal = useCallback(() => {
    terminalCounterRef.current += 1;
    const newId = `terminal-${terminalCounterRef.current}`;
    setTerminals(prev => [...prev, newId]);
    const newIndex = terminals.length;
    setActiveTerminal(newIndex);
    setCameraTarget(getTerminalPosition(newIndex));
    // Focus the new terminal after a short delay
    setTimeout(() => focusTerminal(newId), 200);
  }, [terminals.length, getTerminalPosition]);

  const handleSelectTerminal = useCallback((index: number) => {
    setActiveTerminal(index);
    setCameraTarget(getTerminalPosition(index));
    // Focus the selected terminal
    setTimeout(() => focusTerminal(terminals[index]), 100);
  }, [terminals, getTerminalPosition]);

  const handleCloseTerminal = useCallback((index: number) => {
    if (terminals.length <= 1) return; // Don't close the last terminal

    setTerminals(prev => prev.filter((_, i) => i !== index));

    // Adjust active terminal if needed
    if (index <= activeTerminal) {
      const newActive = Math.max(0, activeTerminal - 1);
      setActiveTerminal(newActive);
      setCameraTarget(getTerminalPosition(newActive));
    }
  }, [terminals.length, activeTerminal, getTerminalPosition]);

  const handleNavigate = useCallback((path: string[]) => {
    setCurrentPath(path);
  }, []);

  const handleCameraTargetChange = useCallback((target: { x: number; y: number; z: number } | null) => {
    setCameraTarget(target);
  }, []);

  const handleSelectedGroupChange = useCallback((group: string | null) => {
    setSelectedGroup(group);
  }, []);

  const handlePanelViewChange = useCallback((panelView: boolean) => {
    setIsPanelView(panelView);
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

    // Use grid system for positions (same as computeGroupPositions)
    const entries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const totalItems = entries.length;

    return entries.map(([nsPrefix], idx) => ({
      id: nsPrefix,
      index: idx,
      position: gridPosition(idx),
    }));
  }, [currentPath]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  // Stack to remember selection index at each navigation level
  const selectionStackRef = useRef<number[]>([]);

  // Select first node when path changes (or restore previous selection when going back)
  useEffect(() => {
    const visibleNodes = getVisibleNamespacesWithPositions();
    if (visibleNodes.length > 0) {
      // Check if we have a stored selection for this level (means we're going back)
      const storedIndex = selectionStackRef.current[currentPath.length];
      if (storedIndex !== undefined && storedIndex < visibleNodes.length) {
        setSelectedIndex(storedIndex);
        setSelectedGroup(visibleNodes[storedIndex].id);
        // Move camera to the restored selection
        setCameraTarget(visibleNodes[storedIndex].position);
        // Clear any stored indices beyond current level
        selectionStackRef.current = selectionStackRef.current.slice(0, currentPath.length);
      } else {
        setSelectedIndex(0);
        setSelectedGroup(visibleNodes[0].id);
      }
    }
  }, [currentPath, getVisibleNamespacesWithPositions]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle terminal with backtick
      if (e.key === "`") {
        e.preventDefault();
        toggleTerminal();
        return;
      }

      // When terminal is shown, only handle Escape to close it
      // Let all other keys go to the terminal
      if (showTerminal) {
        if (e.key === "Escape") {
          e.preventDefault();
          toggleTerminal();
        }
        return;
      }

      if (e.key === "Escape") {
        // Go back one level - selection will be restored from stack by useEffect
        if (currentPath.length > 0) {
          setCurrentPath(currentPath.slice(0, -1));
        }
        setCameraTarget(null);
        setSelectedGroup(null);
        // Don't reset selectedIndex here - useEffect will restore from stack
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        // In panel view, scroll up/down
        if (isPanelView && cameraTarget) {
          e.preventDefault();
          const scrollAmount = e.key === "ArrowUp" ? 3 : -3;
          const newY = cameraTarget.y + scrollAmount;
          setCameraTarget({ ...cameraTarget, y: newY });
        }
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

        // Set camera target to the selected node's position and select the node
        const node = visibleNodes[newIndex];
        console.log('Arrow key navigation:', { newIndex, nodeId: node.id, position: node.position });
        setSelectedGroup(node.id);

        // If in panel view, go to the new node's panel, otherwise go to node position
        if (isPanelView) {
          const panelY = -5 - 10; // Approximate panel center
          setCameraTarget({ x: node.position.x, y: panelY, z: node.position.z });
        } else {
          setCameraTarget(node.position);
        }
      } else if (e.key === " " && selectedGroup) {
        e.preventDefault();
        // Check if selected namespace has children (not a file)
        const depth = currentPath.length + 1;
        const childGroups = getChildNamespaces(selectedGroup, depth + 1);
        const hasChildren = childGroups.size > 1 ||
          (childGroups.size === 1 && !childGroups.has(selectedGroup));

        if (hasChildren) {
          // Space = enter the selected namespace (only if not a file)
          // Save current selection index before navigating
          selectionStackRef.current[currentPath.length] = selectedIndex;
          const lastPart = selectedGroup.split(".").pop()!;
          setCurrentPath([...currentPath, lastPart]);
          setSelectedGroup(null);
          setSelectedIndex(0);
          setCameraTarget({ x: 0, y: 0, z: 0 }); // Reset camera to origin
          setIsPanelView(false);
        } else {
          // It's a file - toggle panel view
          const visibleNodes = getVisibleNamespacesWithPositions();
          const node = visibleNodes.find(n => n.id === selectedGroup);
          if (node) {
            if (isPanelView) {
              // Go back to node position
              setCameraTarget(node.position);
              setIsPanelView(false);
            } else {
              // Go to panel view (below the node)
              const panelY = -5 - 10; // Approximate panel center
              setCameraTarget({ x: node.position.x, y: panelY, z: node.position.z });
              setIsPanelView(true);
            }
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPath, getVisibleNamespacesWithPositions, selectedIndex, selectedGroup, isPanelView, toggleTerminal, showTerminal]);

  return (
    <div
      style={{ width: "100vw", height: "100vh", background: "#0f172a" }}
    >

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

      <Canvas camera={{ position: [0, 0, GRID.CAMERA_Z], fov: 50 }}>
        <Scene
          currentPath={currentPath}
          onNavigate={handleNavigate}
          fileContents={fileContents}
          cameraTarget={cameraTarget}
          onCameraTargetChange={handleCameraTargetChange}
          selectedGroup={selectedGroup}
          onSelectedGroupChange={handleSelectedGroupChange}
          isPanelView={isPanelView}
          onPanelViewChange={handlePanelViewChange}
          showTerminal={showTerminal}
          onShowTerminalChange={setShowTerminal}
          projectPath={projectPath}
          terminals={terminals}
          activeTerminal={activeTerminal}
          onAddTerminal={handleAddTerminal}
          onSelectTerminal={handleSelectTerminal}
          onCloseTerminal={handleCloseTerminal}
          onTerminalSpacingChange={setTerminalSpacing}
          skipInitialAnimation={savedNavState !== null}
        />
      </Canvas>

      {/* Bottom bar with all controls */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "12px 16px",
          background: "rgba(0,0,0,0.7)",
          borderTop: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {/* Project button */}
        <button
          onClick={() => setShowProjectSetup(true)}
          style={{
            background: "rgba(255,255,255,0.1)",
            color: "white",
            border: "none",
            borderRadius: "4px",
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>📁</span>
          Project
        </button>

        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", flex: 1 }}>
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

        {/* clj-kondo status */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
          {kondoRunning ? (
            <span style={{ color: "#fbbf24" }}>clj-kondo...</span>
          ) : kondoResults ? (
            <>
              <span style={{ color: kondoResults.summary?.error > 0 ? "#f87171" : kondoResults.summary?.warning > 0 ? "#fbbf24" : "#4ade80" }}>
                clj-kondo:
              </span>
              {kondoResults.summary?.error > 0 && (
                <span style={{ color: "#f87171" }}>{kondoResults.summary.error}E</span>
              )}
              {kondoResults.summary?.warning > 0 && (
                <span style={{ color: "#fbbf24" }}>{kondoResults.summary.warning}W</span>
              )}
              {!kondoResults.summary?.error && !kondoResults.summary?.warning && (
                <span style={{ color: "#4ade80" }}>OK</span>
              )}
            </>
          ) : (
            <span style={{ color: "#64748b" }}>clj-kondo</span>
          )}
        </div>

        {/* Terminal toggle button */}
        <button
          onClick={toggleTerminal}
          style={{
            background: showTerminal ? "#3b82f6" : "rgba(255,255,255,0.1)",
            color: "white",
            border: "none",
            borderRadius: "4px",
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ fontFamily: "monospace" }}>&gt;_</span>
          Terminal
        </button>
      </div>

      {/* Project setup modal */}
      {showProjectSetup && (
        <ProjectSetup
          onProjectSelect={handleProjectSelect}
          initialPath={projectPath || undefined}
        />
      )}
    </div>
  );
}
