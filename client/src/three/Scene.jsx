import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Board from './Board.jsx';
import Tokens from './Tokens.jsx';
import Dice from './Dice.jsx';
import { useGame } from '../net/store.js';

export default function Scene() {
  const setSelected = useGame((g) => g.setSelected);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 13, 11], fov: 45 }}
      onPointerMissed={() => setSelected(null)}
    >
      <color attach="background" args={['#1b2430']} />
      <hemisphereLight args={['#ffffff', '#3a2a20', 0.9]} />
      <directionalLight
        position={[6, 14, 8]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      <Board />
      <Tokens />
      <Suspense fallback={null}>
        <Dice />
      </Suspense>
      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        minDistance={6}
        maxDistance={24}
        maxPolarAngle={Math.PI / 2.3}
        enableDamping
      />
    </Canvas>
  );
}
