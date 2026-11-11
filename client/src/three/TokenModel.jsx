// Procedural player tokens, built from primitives. ~0.45 units tall, base at y=0.
// Add a token: add a case here and an entry to TOKENS in shared/src/board.js.

function Mat({ color, ...props }) {
  return <meshStandardMaterial color={color} metalness={0.35} roughness={0.35} {...props} />;
}

const WHITE = '#f4f1ea';

function Lighthouse({ color }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.07, 0.11, 0.3, 20]} />
        <Mat color={color} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.092, 0.097, 0.06, 20]} />
        <Mat color={WHITE} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.08, 12]} />
        <Mat color="#ffd166" emissive="#ffb703" emissiveIntensity={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.42, 0]}>
        <coneGeometry args={[0.085, 0.09, 12]} />
        <Mat color={color} />
      </mesh>
    </group>
  );
}

function Boat({ color }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.06, 0]} rotation={[0, 0, Math.PI]} scale={[1.6, 1, 0.8]}>
        <cylinderGeometry args={[0.12, 0.08, 0.1, 4, 1]} />
        <Mat color={color} />
      </mesh>
      <mesh castShadow position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.32, 8]} />
        <Mat color="#6b4f3a" />
      </mesh>
      <mesh castShadow position={[0.06, 0.24, 0]} scale={[1, 1, 0.12]}>
        <coneGeometry args={[0.09, 0.26, 3]} />
        <Mat color={WHITE} />
      </mesh>
    </group>
  );
}

function Anchor({ color }) {
  return (
    <group position={[0, 0.02, 0]}>
      <mesh castShadow position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.022, 0.022, 0.32, 10]} />
        <Mat color={color} />
      </mesh>
      <mesh castShadow position={[0, 0.39, 0]}>
        <torusGeometry args={[0.045, 0.016, 8, 20]} />
        <Mat color={color} />
      </mesh>
      <mesh castShadow position={[0, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.016, 0.016, 0.18, 8]} />
        <Mat color={color} />
      </mesh>
      <mesh castShadow position={[0, 0.13, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.11, 0.022, 8, 20, Math.PI]} />
        <Mat color={color} />
      </mesh>
    </group>
  );
}

function Rocket({ color }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.26, 16]} />
        <Mat color={WHITE} />
      </mesh>
      <mesh castShadow position={[0, 0.39, 0]}>
        <coneGeometry args={[0.07, 0.12, 16]} />
        <Mat color={color} />
      </mesh>
      <mesh position={[0, 0.24, 0.066]}>
        <circleGeometry args={[0.025, 16]} />
        <Mat color="#8ecae6" />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} castShadow rotation={[0, (i * Math.PI * 2) / 3, 0]} position={[0, 0.08, 0]}>
          <boxGeometry args={[0.02, 0.14, 0.24]} />
          <Mat color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Tree({ color }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.03, 0.035, 0.1, 8]} />
        <Mat color="#6b4f3a" />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} castShadow position={[0, 0.15 + i * 0.1, 0]}>
          <coneGeometry args={[0.14 - i * 0.03, 0.16, 14]} />
          <Mat color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Mug({ color }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.1, 0.09, 0.26, 20, 1, true]} />
        <Mat color={color} side={2} />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.02, 20]} />
        <Mat color={color} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.092, 0.092, 0.01, 20]} />
        <Mat color="#4a2c1a" roughness={0.2} />
      </mesh>
      <mesh castShadow position={[0.1, 0.14, 0]}>
        <torusGeometry args={[0.055, 0.017, 8, 16, Math.PI]} />
        <Mat color={color} />
      </mesh>
    </group>
  );
}

function Gem({ color }) {
  return (
    <mesh castShadow position={[0, 0.22, 0]} scale={[1, 1.5, 1]}>
      <octahedronGeometry args={[0.14]} />
      <Mat color={color} metalness={0.2} roughness={0.1} flatShading />
    </mesh>
  );
}

function Pawn({ color }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.025, 0]}>
        <cylinderGeometry args={[0.12, 0.13, 0.05, 20]} />
        <Mat color={color} />
      </mesh>
      <mesh castShadow position={[0, 0.17, 0]}>
        <coneGeometry args={[0.09, 0.26, 20]} />
        <Mat color={color} />
      </mesh>
      <mesh castShadow position={[0, 0.35, 0]}>
        <sphereGeometry args={[0.075, 20, 16]} />
        <Mat color={color} />
      </mesh>
    </group>
  );
}

const MODELS = {
  lighthouse: Lighthouse,
  boat: Boat,
  anchor: Anchor,
  rocket: Rocket,
  tree: Tree,
  mug: Mug,
  diamond: Gem,
  pawn: Pawn,
};

export default function TokenModel({ token, color }) {
  const Model = MODELS[token] || Pawn;
  return <Model color={color} />;
}
