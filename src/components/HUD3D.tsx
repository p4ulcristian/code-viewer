import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HUDButton } from './HUDButton';

interface HUD3DProps {
  showTerminal: boolean;
  onTerminalClick: () => void;
  onWorkspaceClick: () => void;
}

export function HUD3D({
  showTerminal,
  onTerminalClick,
  onWorkspaceClick,
}: HUD3DProps) {
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
    const up = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, 1);    // Y axis
    const forward = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, 2).negate(); // -Z axis

    // Get camera position
    const cameraPosition = new THREE.Vector3().setFromMatrixPosition(cameraMatrix);

    // Position top HUD in front of camera
    const hudPosition = cameraPosition.clone().add(forward.clone().multiplyScalar(hudDistance));

    // Move to top of viewport with margin
    const topMargin = 0.5;
    hudPosition.add(up.clone().multiplyScalar(viewportHeight / 2 - topMargin));

    // Smooth follow (lerp)
    groupRef.current.position.lerp(hudPosition, 0.2);

    // Copy camera rotation so HUD is always flat facing the camera
    groupRef.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={groupRef}>
      {/* Workspace Button - positioned left of center */}
      <HUDButton
        position={[-0.55, 0, 0]}
        onClick={onWorkspaceClick}
        isActive={!showTerminal}
        label="Workspace"
        width={0.9}
        height={0.5}
        fontSize={0.15}
      />

      {/* Terminal Button - positioned right of center */}
      <HUDButton
        position={[0.55, 0, 0]}
        onClick={onTerminalClick}
        isActive={showTerminal}
        label="Terminal"
        width={0.8}
        height={0.5}
        fontSize={0.15}
      />
    </group>
  );
}
