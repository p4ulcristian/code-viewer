import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HUDButton } from './HUDButton';

type ViewMode = 'namespaces' | 'files' | 'terminal';

interface HUD3DProps {
  viewMode: ViewMode;
  onNamespacesClick: () => void;
  onFilesClick: () => void;
  onTerminalClick: () => void;
}

export function HUD3D({
  viewMode,
  onNamespacesClick,
  onFilesClick,
  onTerminalClick,
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

  const buttonHeight = 0.35;
  const buttonGap = 0.08;

  // Calculate button positions (left to right: Namespaces, Files, Terminal)
  const nsWidth = 0.75;
  const filesWidth = 0.5;
  const termWidth = 0.6;

  const totalWidth = nsWidth + filesWidth + termWidth + buttonGap * 2;
  const startX = -totalWidth / 2;

  const nsX = startX + nsWidth / 2;
  const filesX = startX + nsWidth + buttonGap + filesWidth / 2;
  const termX = startX + nsWidth + buttonGap + filesWidth + buttonGap + termWidth / 2;

  return (
    <group ref={groupRef}>
      {/* Namespaces Button */}
      <HUDButton
        position={[nsX, 0, 0]}
        onClick={onNamespacesClick}
        isActive={viewMode === 'namespaces'}
        label="Namespaces"
        width={nsWidth}
        height={buttonHeight}
        fontSize={0.1}
      />

      {/* Files Button */}
      <HUDButton
        position={[filesX, 0, 0]}
        onClick={onFilesClick}
        isActive={viewMode === 'files'}
        label="Files"
        width={filesWidth}
        height={buttonHeight}
        fontSize={0.1}
      />

      {/* Terminal Button */}
      <HUDButton
        position={[termX, 0, 0]}
        onClick={onTerminalClick}
        isActive={viewMode === 'terminal'}
        label="Terminal"
        width={termWidth}
        height={buttonHeight}
        fontSize={0.1}
      />
    </group>
  );
}
