import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGame } from '../net/store.js';
import { TILE_TOP, tokenSpot } from './layout.js';
import TokenModel from './TokenModel.jsx';

const STEP_TIME = 0.16; // seconds per tile
const HOP = 0.35;

function Token({ player, slot }) {
  const ref = useRef();
  // shown = the space the token is visually on; walks toward player.position
  const anim = useRef({ shown: player.position, t: 0, jump: false });

  useFrame((_, dt) => {
    const a = anim.current;
    const target = player.position;
    const g = ref.current;
    if (!g) return;

    if (a.shown !== target) {
      const forward = (target - a.shown + 40) % 40;
      // Teleport-style for jail / backwards moves, walk otherwise.
      a.jump = player.inJail || forward > 12;
      a.t += dt / (a.jump ? STEP_TIME * 3 : STEP_TIME);
      const next = a.jump ? target : (a.shown + 1) % 40;
      const [x0, z0] = tokenSpot(a.shown, slot);
      const [x1, z1] = tokenSpot(next, slot);
      const t = Math.min(a.t, 1);
      g.position.set(x0 + (x1 - x0) * t, TILE_TOP + Math.sin(t * Math.PI) * (a.jump ? 1.2 : HOP), z0 + (z1 - z0) * t);
      if (a.t >= 1) {
        a.shown = next;
        a.t -= 1; // carry leftover time so low frame rates don't slow the walk
      }
    } else {
      const [x, z] = tokenSpot(a.shown, slot);
      g.position.set(x, TILE_TOP, z);
    }
  });

  if (player.bankrupt) return null;
  return (
    <group ref={ref}>
      <TokenModel token={player.token} color={player.color} />
    </group>
  );
}

export default function Tokens() {
  const players = useGame((g) => g.state?.players);
  if (!players) return null;
  return players.map((p, slot) => <Token key={p.id} player={p} slot={slot} />);
}
