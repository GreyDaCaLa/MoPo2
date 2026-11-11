import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { SPACES } from '@mopo/shared';
import { useGame } from '../net/store.js';
import { BOARD_SIZE, SLAB_TOP, TILE_TOP,tileCenter, tileRotation, tileSize, inward } from './layout.js';
import { tileTexture } from './tileTexture.js';

function centerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(512, 512, 50, 512, 512, 720);
  g.addColorStop(0, '#dff1e6');
  g.addColorStop(1, '#b9dcc6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.save();
  ctx.translate(512, 512);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = '#12355b';
  ctx.fillRect(-380, -110, 760, 220);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 170px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MoPo', 0, 10);
  ctx.fillStyle = '#12355b';
  ctx.font = 'italic 48px system-ui, sans-serif';
  ctx.fillText('welcome to Port Mopo', 0, 170);
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Tile({ space }) {
  const [w, h] = tileSize(space.index);
  const [x, z] = tileCenter(space.index);
  const tex = useMemo(() => tileTexture(space, w, h), [space, w, h]);
  const selected = useGame((g) => g.selected === space.index);
  const setSelected = useGame((g) => g.setSelected);
  const [hover, setHover] = useState(false);

  return (
    <mesh
      position={[x, TILE_TOP, z]}
      rotation={[-Math.PI / 2, 0, tileRotation(space.index)]}
      receiveShadow
      onClick={(e) => { e.stopPropagation(); setSelected(space.index); }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
    >
      <planeGeometry args={[w * 0.98, h * 0.98]} />
      <meshStandardMaterial
        map={tex}
        emissive={selected ? '#ffd166' : hover ? '#ffffff' : '#000000'}
        emissiveIntensity={selected ? 0.35 : hover ? 0.12 : 0}
      />
    </mesh>
  );
}

/** Owner color strip on the outer edge + houses/hotel on the color band. */
function Ownership({ index, prop, color }) {
  const [x, z] = tileCenter(index);
  const [ix, iz] = inward(index);
  const rotY = tileRotation(index);
  const outer = 0.72;
  const band = -0.62; // toward the board center
  const isStreet = SPACES[index].type === 'street';

  return (
    <group>
      <mesh position={[x - ix * outer, TILE_TOP + 0.02, z - iz * outer]} rotation={[0, rotY, 0]}>
        <boxGeometry args={[0.8, 0.03, 0.12]} />
        <meshStandardMaterial color={color} transparent opacity={prop.mortgaged ? 0.35 : 1} />
      </mesh>
      {isStreet && prop.houses === 5 && (
        <mesh position={[x - ix * band, TILE_TOP + 0.12, z - iz * band]} rotation={[0, rotY, 0]} castShadow>
          <boxGeometry args={[0.5, 0.22, 0.24]} />
          <meshStandardMaterial color="#c1121f" />
        </mesh>
      )}
      {isStreet && prop.houses > 0 && prop.houses < 5 &&
        Array.from({ length: prop.houses }, (_, n) => {
          const along = (n - (prop.houses - 1) / 2) * 0.2;
          return (
            <group key={n} position={[x - ix * band + -iz * along, TILE_TOP, z - iz * band + ix * along]} rotation={[0, rotY, 0]}>
              <mesh position={[0, 0.07, 0]} castShadow>
                <boxGeometry args={[0.14, 0.14, 0.14]} />
                <meshStandardMaterial color="#2d6a4f" />
              </mesh>
              <mesh position={[0, 0.18, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
                <coneGeometry args={[0.12, 0.1, 4]} />
                <meshStandardMaterial color="#1b4332" />
              </mesh>
            </group>
          );
        })}
    </group>
  );
}

export default function Board() {
  const centerTex = useMemo(centerTexture, []);
  const properties = useGame((g) => g.state?.properties);
  const players = useGame((g) => g.state?.players);
  const colorOf = (id) => players?.find((p) => p.id === id)?.color;

  return (
    <group>
      {/* table */}
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <cylinderGeometry args={[14, 14, 0.4, 64]} />
        <meshStandardMaterial color="#5b3a29" roughness={0.8} />
      </mesh>
      {/* board slab */}
      <mesh position={[0, SLAB_TOP - 0.09, 0]} castShadow receiveShadow>
        <boxGeometry args={[BOARD_SIZE + 0.2, 0.18, BOARD_SIZE + 0.2]} />
        <meshStandardMaterial color="#1d1d1d" />
      </mesh>
      {/* center */}
      <mesh position={[0, TILE_TOP, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[BOARD_SIZE - 3.2, BOARD_SIZE - 3.2]} />
        <meshStandardMaterial map={centerTex} />
      </mesh>
      {SPACES.map((s) => <Tile key={s.index} space={s} />)}
      {properties &&
        Object.entries(properties).map(([i, prop]) =>
          prop.owner ? <Ownership key={i} index={Number(i)} prop={prop} color={colorOf(prop.owner)} /> : null,
        )}
    </group>
  );
}
