import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';

interface HUD3DProps {
  showTerminal: boolean;
  onTerminalClick: () => void;
  onWorkspaceClick: () => void;
}

export function HUD3D({ showTerminal, onTerminalClick, onWorkspaceClick }: HUD3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, size } = useThree();

  // Follow camera every frame
  useFrame(() => {
    if (!groupRef.current) return;

    const perspCamera = camera as THREE.PerspectiveCamera;

    // Calculate viewport size at HUD distance
    const hudDistance = 10;
    const vFov = perspCamera.fov * (Math.PI / 180);
    const viewportHeight = 2 * Math.tan(vFov / 2) * hudDistance;

    // Get camera's local axes from its matrix
    const cameraMatrix = perspCamera.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, 0); // X axis
    const up = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, 1);    // Y axis
    const forward = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, 2).negate(); // -Z axis

    // Get camera position
    const cameraPosition = new THREE.Vector3().setFromMatrixPosition(cameraMatrix);

    // Position HUD in front of camera
    const hudPosition = cameraPosition.clone().add(forward.clone().multiplyScalar(hudDistance));

    // Move to top of viewport (account for button height of 0.4, so offset by 0.2)
    const buttonHalfHeight = 0.2;
    hudPosition.add(up.clone().multiplyScalar(viewportHeight / 2 - buttonHalfHeight));

    // Smooth follow (lerp)
    groupRef.current.position.lerp(hudPosition, 0.2);

    // Copy camera rotation so HUD is always flat facing the camera
    groupRef.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={groupRef}>
      {/* Workspace Button - positioned left of center */}
      <group
        position={[-0.75, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onWorkspaceClick();
        }}
      >
        <mesh>
          <boxGeometry args={[1.4, 0.4, 0.05]} />
          <meshStandardMaterial
            color={!showTerminal ? '#3b82f6' : '#2a2a4a'}
            emissive={!showTerminal ? '#1e40af' : '#1a1a2e'}
            emissiveIntensity={0.3}
          />
        </mesh>
        <Text
          position={[0, 0, 0.03]}
          fontSize={0.15}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
        >
          Workspace
        </Text>
      </group>

      {/* Terminal Button - positioned right of center */}
      <group
        position={[0.75, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onTerminalClick();
        }}
      >
        <mesh>
          <boxGeometry args={[1.2, 0.4, 0.05]} />
          <meshStandardMaterial
            color={showTerminal ? '#3b82f6' : '#2a2a4a'}
            emissive={showTerminal ? '#1e40af' : '#1a1a2e'}
            emissiveIntensity={0.3}
          />
        </mesh>
        <Text
          position={[0, 0, 0.03]}
          fontSize={0.15}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
        >
          Terminal
        </Text>
      </group>
    </group>
  );
}
