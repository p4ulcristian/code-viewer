import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HUDButton } from './HUDButton';

interface BottomHUDProps {
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  onSettingsClick: () => void;
}

export function BottomHUD({
  currentPath,
  onNavigate,
  onSettingsClick,
}: BottomHUDProps) {
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
    const viewportWidth = viewportHeight * (size.width / size.height);

    // Get camera's local axes from its matrix
    const cameraMatrix = perspCamera.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, 0); // X axis
    const up = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, 1);    // Y axis
    const forward = new THREE.Vector3().setFromMatrixColumn(cameraMatrix, 2).negate(); // -Z axis

    // Get camera position
    const cameraPosition = new THREE.Vector3().setFromMatrixPosition(cameraMatrix);

    // Position bottom HUD in front of camera
    const hudPosition = cameraPosition.clone().add(forward.clone().multiplyScalar(hudDistance));

    // Move to bottom-left of viewport with margin
    const bottomMargin = 0.5;
    const leftMargin = 0.5;
    hudPosition.add(up.clone().multiplyScalar(-viewportHeight / 2 + bottomMargin));
    hudPosition.add(right.clone().multiplyScalar(-viewportWidth / 2 + leftMargin));

    // Smooth follow (lerp)
    groupRef.current.position.lerp(hudPosition, 0.2);

    // Copy camera rotation so HUD is always flat facing the camera
    groupRef.current.quaternion.copy(camera.quaternion);
  });

  const buttonSpacing = 0.6;
  const buttonHeight = 0.4;
  const buttonWidth = 0.4;

  return (
    <group ref={groupRef}>
      {/* Settings button with gear icon */}
      <HUDButton
        position={[0, 0, 0]}
        onClick={onSettingsClick}
        label="⚙"
        width={buttonWidth}
        height={buttonHeight}
        fontSize={0.2}
      />

      {/* Breadcrumbs */}
      <HUDButton
        position={[buttonSpacing, 0, 0]}
        onClick={() => onNavigate([])}
        isActive={currentPath.length === 0}
        label="root"
        width={0.5}
        height={buttonHeight}
        fontSize={0.12}
      />

      {currentPath.map((part, idx) => {
        const xPosition = buttonSpacing + (idx + 1) * buttonSpacing;
        const isLast = idx === currentPath.length - 1;
        return (
          <HUDButton
            key={idx}
            position={[xPosition, 0, 0]}
            onClick={() => onNavigate(currentPath.slice(0, idx + 1))}
            isActive={isLast}
            label={part}
            width={Math.max(0.5, part.length * 0.08)}
            height={buttonHeight}
            fontSize={0.12}
          />
        );
      })}
    </group>
  );
}
