import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Sky, Stars, useTexture } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Grid } from '../fireEngine';

interface Props {
  grid: Grid;
  elevation: number[][];
  onCellClick: (x: number, y: number) => void;
  ndviTextureUrl: string;
  elevationTextureUrl: string | null;
  windDirX: number;
  windDirY: number;
  windSpeed: number;
  sceneKey: string;
  useDisplacement: boolean;
}

const PLANE_SIZE = 200;

export function FireScene3D({
  grid,
  elevation,
  onCellClick,
  ndviTextureUrl,
  elevationTextureUrl,
  windDirX,
  windDirY,
  windSpeed,
  sceneKey,
  useDisplacement,
}: Props) {
  const smoothed = useMemo(() => smoothElevation(elevation, 2), [elevation]);
  return (
    <Canvas
      shadows
      camera={{ position: [0, 80, 140], fov: 45, near: 1, far: 2000 }}
      style={{ width: '100%', height: '100%', background: 'radial-gradient(ellipse at 50% 70%, #1a2942 0%, #0a1020 55%, #03060d 100%)' }}
    >
      <Suspense fallback={null}>
        <Lights />
        <Sky
          distance={450000}
          sunPosition={[80, 6, 90]}
          inclination={0.49}
          azimuth={0.25}
          mieDirectionalG={0.92}
          turbidity={8}
          rayleigh={2.5}
        />
        <Stars radius={900} depth={120} count={1800} factor={3.5} saturation={0} fade speed={0.4} />
        <HorizonHaze />
        <fog attach="fog" args={['#1a2334', 320, 900]} />

        <GridFloor planeH={(PLANE_SIZE * grid.length) / (grid[0]?.length ?? 1)} />
        <Water planeH={(PLANE_SIZE * grid.length) / (grid[0]?.length ?? 1)} />
        <Terrain
          grid={grid}
          elevation={smoothed}
          ndviTextureUrl={ndviTextureUrl}
          elevationTextureUrl={elevationTextureUrl}
          onCellClick={onCellClick}
          useDisplacement={useDisplacement}
        />
        <Fire grid={grid} elevation={smoothed} />
        <Smoke grid={grid} elevation={smoothed} windDirX={windDirX} windDirY={windDirY} windSpeed={windSpeed} />
        <Trees grid={grid} elevation={smoothed} sceneKey={sceneKey} />

        <OrbitControls
          minDistance={40}
          maxDistance={400}
          maxPolarAngle={Math.PI / 2.05}
          target={[0, 0, 0]}
        />
      </Suspense>
    </Canvas>
  );
}

function smoothElevation(input: number[][], passes: number): number[][] {
  if (!input.length) return input;
  let current = input.map((r) => [...r]);
  const h = current.length;
  const w = current[0].length;
  for (let p = 0; p < passes; p++) {
    const next: number[][] = [];
    for (let y = 0; y < h; y++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const weight = dx === 0 && dy === 0 ? 4 : Math.abs(dx) + Math.abs(dy) === 1 ? 2 : 1;
            sum += current[ny][nx] * weight;
            n += weight;
          }
        }
        row.push(sum / n);
      }
      next.push(row);
    }
    current = next;
  }
  return current;
}

function elevationAt(elevation: number[][], gx: number, gy: number): number {
  if (!elevation.length) return 0;
  const h = elevation.length;
  const w = elevation[0].length;
  const x = Math.max(0, Math.min(w - 1, gx));
  const y = Math.max(0, Math.min(h - 1, gy));
  return elevation[y][x] * ELEVATION_SCALE;
}

function buildElevationTexture(elevation: number[][]): THREE.CanvasTexture | null {
  if (!elevation.length) return null;
  const h = elevation.length;
  const w = elevation[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(Math.max(0, Math.min(1, elevation[y][x])) * 255);
      const i = (y * w + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.32} color="#aebbcf" />
      <directionalLight
        position={[120, 160, 80]}
        intensity={1.55}
        color="#ffe8b8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={500}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
      />
      <hemisphereLight args={['#aac9ff', '#3a2e22', 0.55]} />
    </>
  );
}

function GridFloor({ planeH }: { planeH: number }) {
  const size = Math.max(PLANE_SIZE, planeH) * 4;
  const divisions = 80;
  return (
    <group position={[0, -2.2, 0]}>
      {/* Dark backdrop plane that the grid sits on top of */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.05, 0]}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color="#070d1a" />
      </mesh>
      {/* Soft radial glow under the terrain */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <circleGeometry args={[Math.max(PLANE_SIZE, planeH) * 0.9, 64]} />
        <meshBasicMaterial color="#1a3358" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {/* Bright primary grid */}
      <gridHelper args={[size, divisions, '#3a6fb0', '#1a2c4a']} position={[0, 0.03, 0]} />
      {/* Wider accent grid every 5 cells for a "data tile" feel */}
      <gridHelper args={[size, divisions / 5, '#5d9bd6', '#2a4674']} position={[0, 0.04, 0]} />
    </group>
  );
}

function HorizonHaze() {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        varying float vY;
        void main() {
          vY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vY;
        void main() {
          // y ranges over the cylinder height; normalize 0..1
          float t = clamp((vY + 60.0) / 160.0, 0.0, 1.0);
          vec3 warm   = vec3(0.95, 0.45, 0.18); // golden-hour orange
          vec3 mid    = vec3(0.42, 0.22, 0.45); // dusk purple
          vec3 cool   = vec3(0.05, 0.09, 0.18); // deep navy
          vec3 col = mix(warm, mid, smoothstep(0.0, 0.45, t));
          col      = mix(col,  cool, smoothstep(0.45, 1.0, t));
          float alpha = smoothstep(1.0, 0.15, t) * 0.85;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
    });
  }, []);
  return (
    <mesh material={material} position={[0, 20, 0]} renderOrder={-1}>
      <cylinderGeometry args={[700, 700, 160, 64, 1, true]} />
    </mesh>
  );
}

function Water({ planeH }: { planeH: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, WATER_LEVEL, 0]} receiveShadow>
      <planeGeometry args={[PLANE_SIZE, planeH]} />
      <meshStandardMaterial
<<<<<<< Updated upstream
        color="#2b4664"
        transparent
        opacity={0.6}
        roughness={0.15}
        metalness={0.55}
        emissive="#0e1c2a"
        emissiveIntensity={0.1}
=======
        color="#1a6aaa"
        transparent
        opacity={0.65}
        roughness={0.1}
        metalness={0.4}
        emissive="#0a3060"
        emissiveIntensity={0.15}
>>>>>>> Stashed changes
      />
    </mesh>
  );
}

const TERRAIN_SEGMENTS_X = 200;
const TERRAIN_SEGMENTS_Y = 150;
const ELEVATION_SCALE = 22;
const WATER_LEVEL = 0.8;

function Terrain({
  grid,
  elevation,
  ndviTextureUrl,
  onCellClick,
  useDisplacement,
}: {
  grid: Grid;
  elevation: number[][];
  ndviTextureUrl: string;
  elevationTextureUrl: string | null;
  onCellClick: (x: number, y: number) => void;
  useDisplacement: boolean;
}) {
  const texture = useTexture(ndviTextureUrl);
  texture.colorSpace = THREE.SRGBColorSpace;

  const w = grid[0]?.length ?? 0;
  const h = grid.length;
  const planeH = (PLANE_SIZE * h) / w;

  // GPU and JS sample the SAME smoothed array → tree feet line up with terrain.
  const displacementTexture = useMemo(() => buildElevationTexture(elevation), [elevation]);

  const burnOverlay = useBurnOverlay(grid);

  return (
    <group>
      <mesh
        rotation-x={-Math.PI / 2}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          const { x, y, z } = e.point;
          const localX = (x + PLANE_SIZE / 2) / PLANE_SIZE;
          const localY = (z + planeH / 2) / planeH;
          if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return;
          const gx = Math.floor(localX * w);
          const gy = Math.floor(localY * h);
          onCellClick(gx, gy);
          void y;
        }}
      >
        <planeGeometry args={[PLANE_SIZE, planeH, TERRAIN_SEGMENTS_X, TERRAIN_SEGMENTS_Y]} />
        <meshStandardMaterial
          map={texture}
          displacementMap={useDisplacement && displacementTexture ? displacementTexture : null}
          displacementScale={useDisplacement ? ELEVATION_SCALE : 0}
          roughness={0.92}
          metalness={0.0}
        />
      </mesh>

      {burnOverlay && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.15, 0]}>
          <planeGeometry args={[PLANE_SIZE, planeH, TERRAIN_SEGMENTS_X, TERRAIN_SEGMENTS_Y]} />
          <meshBasicMaterial
            map={burnOverlay}
            transparent
            opacity={0.85}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

function useBurnOverlay(grid: Grid): THREE.Texture | null {
  const texture = useMemo(() => {
    const w = grid[0]?.length ?? 0;
    const h = grid.length;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [grid.length, grid[0]?.length]);

  if (!texture) return null;
  const canvas = (texture.image as HTMLCanvasElement);
  const ctx = canvas.getContext('2d');
  if (!ctx) return texture;
  const w = grid[0].length;
  const h = grid.length;
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      if (cell.status === 'burned') {
        ctx.fillStyle = 'rgba(20, 12, 8, 0.92)';
        ctx.fillRect(x, y, 1, 1);
      } else if (cell.status === 'firebreak') {
        ctx.fillStyle = 'rgba(40, 36, 32, 0.45)';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  texture.needsUpdate = true;
  return texture;
}

function gridToWorld(gx: number, gy: number, gridW: number, gridH: number) {
  const planeH = (PLANE_SIZE * gridH) / gridW;
  const wx = (gx / gridW) * PLANE_SIZE - PLANE_SIZE / 2 + (PLANE_SIZE / gridW) / 2;
  const wz = (gy / gridH) * planeH - planeH / 2 + (planeH / gridH) / 2;
  return [wx, wz] as const;
}

function Fire({ grid, elevation }: { grid: Grid; elevation: number[][] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const w = grid[0]?.length ?? 0;
  const h = grid.length;

  const burningCells = useMemo(() => {
    const arr: Array<{ x: number; y: number; heat: number }> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y][x].status === 'burning') {
          arr.push({ x, y, heat: grid[y][x].heat });
        }
      }
    }
    return arr;
  }, [grid, w, h]);

  const maxFlames = 4000;

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const t = clock.getElapsedTime();

    const count = Math.min(burningCells.length, maxFlames);
    for (let i = 0; i < count; i++) {
      const { x, y, heat } = burningCells[i];
      const [wx, wz] = gridToWorld(x, y, w, h);
      const groundY = elevationAt(elevation, x, y);
      const flicker = 0.5 + Math.sin(t * 18 + i * 1.3) * 0.25 + Math.cos(t * 11 + i * 0.7) * 0.15;
      const baseHeight = 1.5 + heat * 5;
      const height = baseHeight * (0.9 + flicker * 0.5);
      dummy.position.set(wx, groundY + height / 2, wz);
      dummy.scale.set(1.2 + flicker * 0.3, height, 1.2 + flicker * 0.3);
      dummy.rotation.y = t * 2 + i;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const color = new THREE.Color();
      color.setHSL(0.05 + heat * 0.08, 1, 0.55 + flicker * 0.15);
      mesh.setColorAt(i, color);
    }

    for (let i = count; i < maxFlames; i++) {
      dummy.position.set(0, -1000, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={meshRef} args={[undefined, undefined, maxFlames]} frustumCulled={false}>
        <coneGeometry args={[0.9, 1, 7, 1, true]} />
        <meshBasicMaterial
          color="#ffb040"
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}

function Smoke({
  grid,
  elevation,
  windDirX,
  windDirY,
  windSpeed,
}: {
  grid: Grid;
  elevation: number[][];
  windDirX: number;
  windDirY: number;
  windSpeed: number;
}) {
  const pointsRef = useRef<THREE.Points>(null!);
  const w = grid[0]?.length ?? 0;
  const h = grid.length;
  const MAX = 1500;

  const { geometry, attrs } = useMemo(() => {
    const positions = new Float32Array(MAX * 3);
    const ages = new Float32Array(MAX);
    const seeds = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) ages[i] = Math.random() * 5;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return { geometry: geo, attrs: { positions, ages, seeds } };
  }, []);

  const burningCells = useMemo(() => {
    const arr: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y][x].status === 'burning') arr.push({ x, y });
      }
    }
    return arr;
  }, [grid, w, h]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const positions = attrs.positions;
    const ages = attrs.ages;
    const seeds = attrs.seeds;

    const wind = windSpeed / 14;
    const driftX = windDirX * wind * delta * 12;
    const driftZ = windDirY * wind * delta * 12;

    for (let i = 0; i < MAX; i++) {
      ages[i] += delta;
      if (ages[i] > 4 || positions[i * 3 + 1] > 80) {
        if (burningCells.length === 0) {
          positions[i * 3] = 0;
          positions[i * 3 + 1] = -10000;
          positions[i * 3 + 2] = 0;
          continue;
        }
        const c = burningCells[Math.floor(Math.random() * burningCells.length)];
        const [wx, wz] = gridToWorld(c.x, c.y, w, h);
        const groundY = elevationAt(elevation, c.x, c.y);
        positions[i * 3] = wx + (Math.random() - 0.5) * 1.5;
        positions[i * 3 + 1] = groundY + 1.5;
        positions[i * 3 + 2] = wz + (Math.random() - 0.5) * 1.5;
        ages[i] = 0;
        seeds[i] = Math.random();
      } else {
        positions[i * 3] += driftX + Math.sin(ages[i] * 2 + seeds[i] * 10) * 0.05;
        positions[i * 3 + 1] += delta * (3.5 + seeds[i] * 1.5);
        positions[i * 3 + 2] += driftZ + Math.cos(ages[i] * 2 + seeds[i] * 10) * 0.05;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={6}
        color="#222226"
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

type TreeKind = 'conifer' | 'broadleaf';

interface TreePlace {
  x: number;
  y: number;
  scale: number;
  offsetX: number;
  offsetZ: number;
  kind: TreeKind;
}

function Trees({
  grid,
  elevation,
  sceneKey,
}: {
  grid: Grid;
  elevation: number[][];
  sceneKey: string;
}) {
  const trunkRef = useRef<THREE.InstancedMesh>(null!);
  const coneLeavesRef = useRef<THREE.InstancedMesh>(null!);
  const ballLeavesRef = useRef<THREE.InstancedMesh>(null!);
  const w = grid[0]?.length ?? 0;
  const h = grid.length;
  const initialGridRef = useRef<Grid | null>(null);
  const lastKeyRef = useRef<string>('');

  if (lastKeyRef.current !== sceneKey || initialGridRef.current === null) {
    initialGridRef.current = grid;
    lastKeyRef.current = sceneKey;
  }

  const treeCells = useMemo<TreePlace[]>(() => {
    const snapshot = initialGridRef.current ?? grid;
    const arr: TreePlace[] = [];
    let seed = 1;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = snapshot[y]?.[x];
        if (!cell) continue;
        if (cell.fuel > 55 && cell.status !== 'firebreak') {
          if (rand() < 0.45) {
            // Cell elevation determines mix: high = mostly conifer, low = mostly broadleaf
            const elevFrac = Math.min(1, (elevation[y]?.[x] ?? 0));
            const coniferChance = 0.35 + elevFrac * 0.5;
            const kind: TreeKind = rand() < coniferChance ? 'conifer' : 'broadleaf';
            arr.push({
              x,
              y,
              scale: 0.7 + rand() * 0.7,
              offsetX: (rand() - 0.5) * 1.2,
              offsetZ: (rand() - 0.5) * 1.2,
              kind,
            });
          }
        }
      }
    }
    return arr;
  }, [sceneKey, w, h]);

  const MAX_PER_KIND = 3000;

  useEffect(() => {
    const trunkMesh = trunkRef.current;
    const coneMesh = coneLeavesRef.current;
    const ballMesh = ballLeavesRef.current;
    if (!trunkMesh || !coneMesh || !ballMesh) return;

    const dummy = new THREE.Object3D();
    const hidden = new THREE.Object3D();
    hidden.position.set(0, -10000, 0);
    hidden.scale.set(0, 0, 0);
    hidden.updateMatrix();

    let coneIdx = 0;
    let ballIdx = 0;
    let trunkIdx = 0;
    const trunkMax = MAX_PER_KIND * 2;

    for (let i = 0; i < treeCells.length; i++) {
      const t = treeCells[i];
      if (t.kind === 'conifer' && coneIdx >= MAX_PER_KIND) continue;
      if (t.kind === 'broadleaf' && ballIdx >= MAX_PER_KIND) continue;
      if (trunkIdx >= trunkMax) break;

      const [wx, wz] = gridToWorld(t.x, t.y, w, h);
      const groundY = elevationAt(elevation, t.x, t.y);
      const x = wx + t.offsetX;
      const z = wz + t.offsetZ;
      const trunkH = (t.kind === 'conifer' ? 1.6 : 1.3) * t.scale;
      const leanX = Math.sin(x * 1.7 + z * 0.9) * 0.04;
      const leanZ = Math.cos(x * 1.1 - z * 1.4) * 0.04;

      // Trunk (shared cylinder mesh)
      dummy.position.set(x, groundY + trunkH / 2 - 0.05, z);
      dummy.scale.set(t.scale * 0.3, trunkH, t.scale * 0.3);
      dummy.rotation.set(leanX, 0, leanZ);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(trunkIdx, dummy.matrix);
      trunkIdx++;

      // Color: lower elevation → lush light green, higher → darker
      const elevFactor = Math.min(1, groundY / (ELEVATION_SCALE * 0.8));
      const hue = 0.27 - elevFactor * 0.04;
      const sat = 0.45 + (1 - elevFactor) * 0.25;
      const light = 0.18 + (1 - elevFactor) * 0.18 + ((i * 13) % 4) * 0.015;
      const color = new THREE.Color().setHSL(hue, sat, light);

      if (t.kind === 'conifer') {
        // Tall, pointy cone canopy
        const canopyH = 3.4 * t.scale;
        const canopyR = 1.0 * t.scale;
        dummy.position.set(x + leanX * 1.2, groundY + trunkH + canopyH / 2, z + leanZ * 1.2);
        dummy.scale.set(canopyR, canopyH, canopyR);
        dummy.rotation.set(leanX, (i * 0.37) % (Math.PI * 2), leanZ);
        dummy.updateMatrix();
        coneMesh.setMatrixAt(coneIdx, dummy.matrix);
        coneMesh.setColorAt(coneIdx, color);
        coneIdx++;
      } else {
        // Rounded faceted canopy
        const canopyR = 1.5 * t.scale;
        const stretch = 0.85 + ((i * 7) % 5) * 0.06;
        dummy.position.set(x + leanX * 0.8, groundY + trunkH + canopyR * 0.55, z + leanZ * 0.8);
        dummy.scale.set(canopyR, canopyR * stretch, canopyR);
        dummy.rotation.set(leanX, (i * 0.37) % (Math.PI * 2), leanZ);
        dummy.updateMatrix();
        ballMesh.setMatrixAt(ballIdx, dummy.matrix);
        ballMesh.setColorAt(ballIdx, color);
        ballIdx++;
      }
    }

    // Hide unused slots
    for (let i = coneIdx; i < MAX_PER_KIND; i++) coneMesh.setMatrixAt(i, hidden.matrix);
    for (let i = ballIdx; i < MAX_PER_KIND; i++) ballMesh.setMatrixAt(i, hidden.matrix);
    for (let i = trunkIdx; i < trunkMax; i++) trunkMesh.setMatrixAt(i, hidden.matrix);

    trunkMesh.instanceMatrix.needsUpdate = true;
    coneMesh.instanceMatrix.needsUpdate = true;
    ballMesh.instanceMatrix.needsUpdate = true;
    if (coneMesh.instanceColor) coneMesh.instanceColor.needsUpdate = true;
    if (ballMesh.instanceColor) ballMesh.instanceColor.needsUpdate = true;
    trunkMesh.count = trunkIdx;
    coneMesh.count = coneIdx;
    ballMesh.count = ballIdx;
  }, [treeCells, w, h, elevation]);

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, MAX_PER_KIND * 2]} castShadow>
        <cylinderGeometry args={[1, 1.1, 1, 6]} />
        <meshStandardMaterial color="#3a2a1f" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={coneLeavesRef} args={[undefined, undefined, MAX_PER_KIND]} castShadow>
        <coneGeometry args={[1, 1, 8]} />
        <meshStandardMaterial color="#2d5a2a" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={ballLeavesRef} args={[undefined, undefined, MAX_PER_KIND]} castShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#3a7036" roughness={0.78} flatShading />
      </instancedMesh>
    </group>
  );
}

export function preloadNDVI(url: string) {
  void useLoader;
  void url;
}
