import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';

interface HUDButtonProps {
  position: [number, number, number];
  onClick: () => void;
  isActive?: boolean;
  label: string;
  width?: number;
  height?: number;
  fontSize?: number;
  isAddButton?: boolean;
  isCloseButton?: boolean;
}

export function HUDButton({
  position,
  onClick,
  isActive = false,
  label,
  width = 0.5,
  height = 0.5,
  fontSize = 0.15,
  isAddButton = false,
  isCloseButton = false,
}: HUDButtonProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const frameWidth = width + 0.08;
  const frameHeight = height + 0.08;

  // Animate the button
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
          <boxGeometry args={[width, height, 0.08]} />
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
          <boxGeometry args={[frameWidth, frameHeight, 0.15]} />
          <meshStandardMaterial
            color={edgeColor}
            metalness={0.4}
            roughness={0.3}
          />
        </mesh>
        {/* Text on front face */}
        <Text
          position={[0, 0, 0.15]}
          fontSize={fontSize}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {label}
        </Text>
        {/* Glow indicator for active button */}
        {isActive && (
          <pointLight position={[0, 0, 0.3]} intensity={0.5} distance={1} color="#60a5fa" />
        )}
      </group>
    </group>
  );
}
