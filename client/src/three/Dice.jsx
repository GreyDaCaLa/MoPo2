import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useGame } from '../net/store.js';
import { TILE_TOP } from './layout.js';

const MODEL = '/models/dice/Dice.gltf';
const SIZE = 0.5; // model is 0.5 units, origin at its base
const ROLL_TIME = 1.1;

// Euler (degrees) that puts each face on top — carried over from the original MoPo prototype
// (verified against the model's pip geometry).
const FACE_UP = {
  1: [-90, 0, 0],
  2: [90, 0, 0],
  3: [0, 0, 90],
  4: [180, 0, 0],
  5: [0, 0, -90],
  6: [0, 0, 0],
};
const deg = THREE.MathUtils.degToRad;
const faceQuat = (n, yaw) =>
  new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0, yaw, 0))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...FACE_UP[n].map(deg))));

function Die({ value, rollId, position }) {
  const { scene } = useGLTF(MODEL);
  const model = useMemo(() => {
    const m = scene.clone(true);
    m.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    return m;
  }, [scene]);
  const ref = useRef();
  const anim = useRef({ rollId: null, t: ROLL_TIME, spin: new THREE.Vector3(), yaw: 0 });

  useFrame((_, dt) => {
    const a = anim.current;
    const g = ref.current;
    if (!g) return;
    if (a.rollId !== rollId) {
      a.rollId = rollId;
      a.t = 0;
      a.spin.set(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10);
      a.yaw = (Math.random() - 0.5) * 0.6;
    }
    const target = faceQuat(value, a.yaw);
    const restY = TILE_TOP + 0.02 + SIZE / 2;
    if (a.t < ROLL_TIME) {
      a.t += dt;
      const k = Math.min(a.t / ROLL_TIME, 1);
      g.rotation.x += a.spin.x * dt * (1 - k);
      g.rotation.y += a.spin.y * dt * (1 - k);
      g.rotation.z += a.spin.z * dt * (1 - k);
      g.quaternion.slerp(target, k * k);
      g.position.y = restY + Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 1.5;
    } else {
      g.quaternion.copy(target);
      g.position.y = restY;
    }
  });

  return (
    <group ref={ref} position={[position[0], TILE_TOP + SIZE / 2, position[1]]}>
      <primitive object={model} position={[0, -SIZE / 2, 0]} />
    </group>
  );
}

/** One player's pair of dice on a base in their color. */
function Pair({ roll, rollId, color, x, z }) {
  return (
    <group>
      <mesh position={[x, TILE_TOP + 0.01, z]} receiveShadow>
        <cylinderGeometry args={[0.62, 0.62, 0.02, 40]} />
        <meshStandardMaterial color={color} transparent opacity={0.55} />
      </mesh>
      <Die value={roll.d1} rollId={rollId} position={[x - 0.3, z]} />
      <Die value={roll.d2} rollId={rollId} position={[x + 0.3, z]} />
    </group>
  );
}

/** All dice from the latest roll event, laid out in up to 3 columns. */
export default function Dice() {
  const lastRolls = useGame((g) => g.state?.lastRolls);
  const players = useGame((g) => g.state?.players);
  if (!lastRolls) return null;
  const n = lastRolls.rolls.length;
  const cols = Math.min(n, 3);
  const rows = Math.ceil(n / cols);
  return lastRolls.rolls.map((r, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * 1.5;
    const z = (row - (rows - 1) / 2) * 1.4 + 0.4;
    const color = players.find((p) => p.id === r.player)?.color ?? '#ffffff';
    return <Pair key={r.player} roll={r} rollId={lastRolls.id} color={color} x={x} z={z} />;
  });
}

useGLTF.preload(MODEL);
