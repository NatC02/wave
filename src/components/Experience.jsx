import React, { useRef, useState, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

const colorConfig = {
  skullColor: '#823200',
  pulseColor: '#D3D4D9',
  backgroundColor: '#0E0920',
  _threeColors: {}
};

// Initialize color cache once at start
const initColorCache = () => {
  colorConfig._threeColors = {
    skull: new THREE.Color(colorConfig.skullColor),
    pulse: new THREE.Color(colorConfig.pulseColor),
    background: new THREE.Color(colorConfig.backgroundColor)
  };
};

const getThreeColor = (type) => {
  if (!colorConfig._threeColors.skull) {
    initColorCache();
  }
  return colorConfig._threeColors[type];
};

// Simplified noise function
const noise = (x, y, z) => {
  return Math.sin(x * 1.7 + z * 3.1) * Math.cos(y * 2.3 + x * 0.9) * Math.sin(z * 4.1 + y * 1.4) * 0.5 + 0.5;
};

// Default camera preset
const defaultCameraPreset = {
  orbitDistance: 8.0,
  moveSpeed: 1.6,
  orbitSpeed: 0.35,
  coneAngle: 45,
  transitionDuration: 1.4,
  orbitDuration: 12.0,
  pulseStartThreshold: 0.7,
};

const PointCloudSkull = forwardRef(({ modelScene, particleTexture, pulseSettings, handleValidClick }, ref) => {
  const pointsRef = useRef();  
  const originalColor = getThreeColor('skull');
  const tempColor = useMemo(() => new THREE.Color(), []);

  const [pulseState, setPulseState] = useState({
    isPulsing: false,
    pulseTime: 0,
    pulsePosition: new THREE.Vector3(),
    lastPulseTime: 0,
    targetColor: getThreeColor('pulse'),
  });

  const geometry = useMemo(() => {
    if (!modelScene) return null;

    let sampler;
    const tempGeometry = new THREE.BufferGeometry();

    modelScene.traverse((obj) => {
      if (obj.isMesh) {
        sampler = new MeshSurfaceSampler(obj).build();
      }
    });

    if (!sampler) return null;
    

    const tempPosition = new THREE.Vector3();
    const particleCount = 50000;

    for (let i = 0; i < particleCount; i++) {
      sampler.sample(tempPosition);
      vertices.push(tempPosition.x, tempPosition.y, tempPosition.z);
    }

    tempGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    );

    tempGeometry.setAttribute(
      'originalPosition',
      new THREE.Float32BufferAttribute(vertices.slice(), 3)
    );

    const colors = new Float32Array(vertices.length);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = originalColor.r;
      colors[i + 1] = originalColor.g;
      colors[i + 2] = originalColor.b;
    }

    tempGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colors, 3)
    );

    return tempGeometry;
  }, [modelScene, originalColor]);

  useEffect(() => {
    if (pulseSettings.pulseColor && pulseSettings.pulseColor !== colorConfig.pulseColor) {
      colorConfig.pulseColor = pulseSettings.pulseColor;
      colorConfig._threeColors.pulse = new THREE.Color(pulseSettings.pulseColor);
      
      setPulseState(prev => ({
        ...prev,
        targetColor: colorConfig._threeColors.pulse
      }));
    }
  }, [pulseSettings.pulseColor]);

  const handleClick = (event) => {
    event.stopPropagation();
    
    if (!event.intersections || event.intersections.length === 0) return;
    
    const firstIntersection = event.intersections[0];
    if (firstIntersection.object !== pointsRef.current) return;
    
    const distanceThreshold = 10;
    if (firstIntersection.distance > distanceThreshold) return;

    const clickPoint = event.point.clone();
    const estimatedNormal = new THREE.Vector3()
      .subVectors(clickPoint, new THREE.Vector3(0, 0, 0))
      .normalize();

    handleValidClick(clickPoint, estimatedNormal);
  };

  const triggerPulse = (position) => {
    setPulseState(prev => ({
      ...prev,
      isPulsing: true,
      pulseTime: 0,
      pulsePosition: position.clone(),
      lastPulseTime: Date.now() / 1000,
    }));
  };

  useImperativeHandle(ref, () => ({ triggerPulse }));

  // Pre-allocate reusable vectors outside the loop
  const particlePos = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const totalDisplacement = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    if (!pointsRef.current || !geometry) return;

    const { pulseTime, pulsePosition, isPulsing, targetColor } = pulseState;
    const {
      pulseRadius,
      pulseDuration,
      pulseIntensity,
      pulseDecay,
      pulseSpeed,
      pulseWaveWidth,
      pulseRingsCount,
      ambientMotion,
      colorShiftIntensity,
      verticalBias
    } = pulseSettings;

    const time = state.clock.getElapsedTime();
    const positions = pointsRef.current.geometry.attributes.position;
    const originalPositions = pointsRef.current.geometry.attributes.originalPosition;
    const colors = pointsRef.current.geometry.attributes.color;

    // Apply ambient motion to every Nth particle when not pulsing for performance
    if (!isPulsing) {
      const skipFactor = 3; // Process every 3rd particle for ambient motion
      for (let i = 0; i < positions.count; i += skipFactor) {
        const x = originalPositions.getX(i);
        const y = originalPositions.getY(i);
        const z = originalPositions.getZ(i);

        const noiseScale = 3.0;
        const timeScale = 0.2;
        const nx = noise(x * noiseScale, y * noiseScale, time * timeScale) * ambientMotion;
        const ny = noise(y * noiseScale, z * noiseScale, time * timeScale + 100) * ambientMotion;
        const nz = noise(z * noiseScale, x * noiseScale, time * timeScale + 200) * ambientMotion;

        positions.setX(i, x + nx);
        positions.setY(i, y + ny);
        positions.setZ(i, z + nz);

        colors.setXYZ(i, originalColor.r, originalColor.g, originalColor.b);
      }

      positions.needsUpdate = true;
      colors.needsUpdate = true;
      return;
    }

    const newPulseTime = pulseTime + delta * pulseSpeed;
    const progress = Math.min(newPulseTime / pulseDuration, 1);

    for (let i = 0; i < positions.count; i++) {
      const x = originalPositions.getX(i);
      const y = originalPositions.getY(i);
      const z = originalPositions.getZ(i);
      
      particlePos.set(x, y, z);
      const distance = particlePos.distanceTo(pulsePosition);

      totalDisplacement.set(0, 0, 0);
      let totalEffect = 0;

      // Optimization: Only compute pulse effect if particle is within max range
      const maxRange = pulseRadius * (1 + pulseWaveWidth);
      if (distance < maxRange) {
        for (let ring = 0; ring < pulseRingsCount; ring++) {
          const ringOffset = ring * (pulseRadius / Math.max(1, pulseRingsCount - 1));
          const currentRadius = progress * (pulseRadius - ringOffset);
          const pulseWidth = pulseRadius * pulseWaveWidth;
  
          const pulse = (1 - Math.abs(distance - currentRadius) / pulseWidth) * 
                        Math.pow(1 - progress, pulseDecay);
  
          const effect = Math.max(0, Math.min(pulse, 1)) * pulseIntensity;
          totalEffect += effect;
  
          if (effect > 0.01) { // Skip negligible effects
            direction.subVectors(particlePos, pulsePosition).normalize();
            direction.z += verticalBias;
            direction.normalize();
            
            totalDisplacement.add(direction.multiplyScalar(effect));
          }
        }
      }

      const noiseScale = 3.0;
      const timeScale = 0.2;
      const nx = noise(x * noiseScale, y * noiseScale, time * timeScale) * ambientMotion;
      const ny = noise(y * noiseScale, z * noiseScale, time * timeScale + 100) * ambientMotion;
      const nz = noise(z * noiseScale, x * noiseScale, time * timeScale + 200) * ambientMotion;

      positions.setX(i, x + totalDisplacement.x + nx);
      positions.setY(i, y + totalDisplacement.y + ny);
      positions.setZ(i, z + totalDisplacement.z + nz);

      if (totalEffect > 0.01) {
        const colorEffect = Math.min(totalEffect * colorShiftIntensity, 1);
        tempColor.copy(originalColor).lerp(targetColor, colorEffect);
        colors.setXYZ(i, tempColor.r, tempColor.g, tempColor.b);
      } else {
        colors.setXYZ(i, originalColor.r, originalColor.g, originalColor.b);
      }
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;

    if (progress >= 1) {
      setPulseState(prev => ({ ...prev, isPulsing: false, pulseTime: 0 }));
    } else {
      setPulseState(prev => ({ ...prev, pulseTime: newPulseTime }));
    }
  });

  if (!geometry || !particleTexture) return null;

  return (
    <points ref={pointsRef} geometry={geometry} onClick={handleClick}>
      <pointsMaterial
        size={0.12} // Slightly larger points to compensate for fewer particles
        blending={THREE.AdditiveBlending}
        transparent
        opacity={0.8}
        depthWrite={false}
        sizeAttenuation
        vertexColors
        alphaMap={particleTexture}
      />
    </points>
  );
});

export function Experience() {
  const { camera } = useThree();
  const controls = useRef();
  const pointCloudRef = useRef();

  useEffect(() => {
    initColorCache();
  }, []);

  const [pulseSettings] = useState({
    pulseRadius: 2.0,
    pulseIntensity: 0.2,
    pulseDuration: 4,
    pulseColor: colorConfig.pulseColor,
    pulseCooldown: 6,
    pulseSpeed: 0.1,
    pulseDecay: 0.1,
    pulseWaveWidth: 0.2,
    pulseRingsCount: 3,
    verticalBias: 0.3,
    ambientMotion: 0.03,
    colorShiftIntensity: 0.7,
  });

  const [cameraSettings] = useState({
    ...defaultCameraPreset,
    coneUpVector: new THREE.Vector3(0, 1, 0),
  });

  const [pendingPulse, setPendingPulse] = useState(null);

  const [cameraAnimation, setCameraAnimation] = useState({
    isAnimating: false,
    targetPosition: new THREE.Vector3(),
    surfaceNormal: new THREE.Vector3(0, 1, 0),
    startPosition: new THREE.Vector3(),
    startTime: 0,
    orbitStartTime: 0,
    isOrbiting: false,
    orbitAxis: new THREE.Vector3(0, 1, 0),
    pulseTriggered: false,
  });

  const particleTexture = useTexture('point-texture.jpg');
  const { scene: modelScene } = useGLTF('/model.glb');

  useEffect(() => {
    if (controls.current) {
      camera.position.set(2, -0.4, 6.1);
      
      controls.current.minDistance = 0.5;
      controls.current.maxDistance = 9;
      controls.current.enableRotate = true;
      controls.current.enableZoom = true;
      controls.current.zoomSpeed = 0.5;
      controls.current.enablePan = false;
      controls.current.autoRotate = false;
      
      document.querySelector('.main--title')?.classList.add('ended');
    }
  }, [camera]);

  const handleValidClick = (clickPoint, clickNormal) => {
    const currentTime = Date.now() / 1000;
    if (currentTime - (pendingPulse?.lastPulseTime || 0) < pulseSettings.pulseCooldown) {
      return;
    }

    if (controls.current) {
      controls.current.enabled = false;
    }

    setPendingPulse({
      clickPoint: clickPoint.clone(),
      clickNormal: clickNormal ? clickNormal.clone() : new THREE.Vector3(0, 1, 0),
      lastPulseTime: currentTime,
    });

    setCameraAnimation({
      isAnimating: true,
      targetPosition: clickPoint.clone(),
      surfaceNormal: clickNormal ? clickNormal.clone() : new THREE.Vector3(0, 1, 0),
      startPosition: camera.position.clone(),
      startTime: currentTime,
      orbitStartTime: 0,
      isOrbiting: false,
      pulseTriggered: false,
    });
  };

  const triggerPulseEffect = () => {
    if (pendingPulse && pointCloudRef.current?.triggerPulse) {
      pointCloudRef.current.triggerPulse(pendingPulse.clickPoint);
      setPendingPulse(null);
    }
  };

  // Reusable vector objects to avoid creating new ones in the animation loop
  const orbitPos = useMemo(() => new THREE.Vector3(), []);
  const targetOrbitPos = useMemo(() => new THREE.Vector3(), []);
  const cameraToTarget = useMemo(() => new THREE.Vector3(), []);
  const localCameraDir = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (!cameraAnimation.isAnimating) return;

    const currentTime = Date.now() / 1000;
    const elapsedTime = currentTime - cameraAnimation.startTime;
    const {
      moveSpeed,
      orbitSpeed,
      transitionDuration,
      orbitDuration,
      orbitDistance,
      coneAngle,
      coneUpVector,
      pulseStartThreshold
    } = cameraSettings;

    if (!cameraAnimation.isOrbiting) {
      const progress = Math.min(elapsedTime / transitionDuration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      const coneAxis = cameraAnimation.surfaceNormal;

      const alignmentQuaternion = new THREE.Quaternion().setFromUnitVectors(
        coneUpVector,
        coneAxis
      );

      const coneAngleRad = (coneAngle * Math.PI) / 180;

      const orbitRadius = Math.sin(coneAngleRad) * orbitDistance;
      const orbitHeight = Math.cos(coneAngleRad) * orbitDistance;

      cameraToTarget.subVectors(
        cameraAnimation.startPosition,
        cameraAnimation.targetPosition
      );
      
      localCameraDir.copy(cameraToTarget);
      const inverseQuaternion = alignmentQuaternion.clone().invert();
      localCameraDir.applyQuaternion(inverseQuaternion);
      localCameraDir.y = 0;
      localCameraDir.normalize();
      
      const entryAngle = Math.atan2(localCameraDir.x, localCameraDir.z);
      const initAngle = entryAngle + Math.PI;

      orbitPos.set(
        Math.sin(initAngle) * orbitRadius,
        orbitHeight,
        Math.cos(initAngle) * orbitRadius
      ).applyQuaternion(alignmentQuaternion);

      targetOrbitPos.copy(cameraAnimation.targetPosition).add(orbitPos);

      camera.position.lerpVectors(
        cameraAnimation.startPosition,
        targetOrbitPos,
        easedProgress
      );

      camera.lookAt(cameraAnimation.targetPosition);

      if (!cameraAnimation.pulseTriggered && progress >= pulseStartThreshold) {
        triggerPulseEffect();
        setCameraAnimation(prev => ({...prev, pulseTriggered: true}));
      }

      if (progress >= 1) {
        const endPos = camera.position.clone().sub(cameraAnimation.targetPosition);
        endPos.applyQuaternion(inverseQuaternion);
        const actualAngle = Math.atan2(endPos.x, endPos.z);
        
        setCameraAnimation(prev => ({
          ...prev,
          isOrbiting: true,
          orbitStartTime: currentTime,
          orbitAxis: coneAxis,
          orbitStartPosition: camera.position.clone(),
          initialOrbitAngle: actualAngle
        }));
      }
    }
    else {
      const orbitElapsedTime = currentTime - cameraAnimation.orbitStartTime;
      const orbitProgress = Math.min(orbitElapsedTime / orbitDuration, 1);

      const coneAngleRad = (coneAngle * Math.PI) / 180;

      const orbitRadius = Math.sin(coneAngleRad) * orbitDistance;
      const orbitHeight = Math.cos(coneAngleRad) * orbitDistance;

      const alignmentQuaternion = new THREE.Quaternion().setFromUnitVectors(
        coneUpVector,
        cameraAnimation.orbitAxis
      );

      const initialAngle = cameraAnimation.initialOrbitAngle;
      const angle = initialAngle + orbitElapsedTime * orbitSpeed;

      orbitPos.set(
        Math.sin(angle) * orbitRadius,
        orbitHeight,
        Math.cos(angle) * orbitRadius
      ).applyQuaternion(alignmentQuaternion);

      targetOrbitPos.copy(cameraAnimation.targetPosition).add(orbitPos);

      const orbitTransitionDuration = 0.6;
      if (orbitElapsedTime < orbitTransitionDuration) {
        const t = orbitElapsedTime / orbitTransitionDuration;
        const easedT = t < 0.5 
          ? 16 * t * t * t * t * t 
          : 1 - Math.pow(-2 * t + 2, 5) / 2;

        camera.position.lerpVectors(
          cameraAnimation.orbitStartPosition,
          targetOrbitPos,
          easedT
        );
      } else {
        camera.position.copy(targetOrbitPos);
      }

      camera.lookAt(cameraAnimation.targetPosition);

      if (orbitProgress >= 1) {
        setCameraAnimation(prev => ({
          ...prev,
          isAnimating: false,
          isOrbiting: false,
          pulseTriggered: false
        }));

        if (controls.current) {
          controls.current.enabled = true;
        }
      }
    }
  });

  return (
    <>
      <color attach="background" args={[getThreeColor('background')]} />

      <PointCloudSkull
        ref={pointCloudRef}
        modelScene={modelScene}
        particleTexture={particleTexture}
        pulseSettings={pulseSettings}
        handleValidClick={handleValidClick}
      />
    </>
  );
}