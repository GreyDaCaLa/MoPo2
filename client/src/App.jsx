import { useGame } from './net/store.js';
import { Lobby } from './ui/Lobby.jsx';
import RoomSetup from './ui/RoomSetup.jsx';
import Hud, { Toast } from './ui/Hud.jsx';
import Scene from './three/Scene.jsx';

export default function App() {
  const state = useGame((g) => g.state);
  const code = useGame((g) => g.code);

  if (!code || !state) return <><Lobby /><Toast /></>;
  if (state.phase === 'lobby') return <><RoomSetup /><Toast /></>;
  return (
    <>
      <Scene />
      <Hud />
    </>
  );
}
