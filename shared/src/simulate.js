// Bot-only game simulator, for tests and balancing.
//   node src/simulate.js [games=200] [mode=classic|party] [maxTurns=0|20|30|50|75]
import { pathToFileURL } from 'node:url';
import { createGame, addPlayer, removePlayer, startGame, applyAction, updateSettings, netWorth, nextAuctionDeadline, tickAuctions } from './engine.js';
import { addBot, decideBotAction } from './bots.js';

/** Small seeded PRNG so simulated games are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Play one game with only bots. Throws if a bot ever attempts an illegal
 * action or the game stalls with nobody able to act.
 */
export function simulateGame({ mode = 'classic', difficulties = ['easy', 'medium', 'hard'], maxTurns = 0, seed = 1, maxSteps = 50_000 } = {}) {
  const rng = mulberry32(seed);
  let s = createGame('SIM');
  s = addPlayer(s, 'host', 'Host');
  for (const d of difficulties) s = addBot(s, 'host', d);
  s = updateSettings(s, 'host', { mode, maxTurns });
  s = removePlayer(s, 'host');
  s.hostId = s.players[0].id; // let a bot press Start
  s = startGame(s, s.hostId, { rng, now: 0 });

  let steps = 0;
  let now = 0;
  while (s.phase === 'playing' && steps < maxSteps) {
    now += 1000;
    let acted = false;
    for (const p of s.players) {
      const action = decideBotAction(s, p.id, rng);
      if (!action) continue;
      try {
        s = applyAction(s, p.id, action, { rng, now });
      } catch (err) {
        err.message = `Bot ${p.name} (${p.bot.difficulty}) tried ${JSON.stringify(action)}: ${err.message}`;
        throw err;
      }
      acted = true;
      steps++;
      break;
    }
    if (!acted) {
      // Nobody has anything to do: a live auction may be waiting on its countdown.
      const deadline = nextAuctionDeadline(s);
      if (deadline != null) {
        now = Math.max(now, deadline);
        s = tickAuctions(s, { rng, now });
        continue;
      }
      throw new Error(`Game stalled on turn ${s.turn.number}: no bot can act`);
    }
  }

  const winner = s.players.find((p) => p.id === s.winner);
  return {
    state: s,
    steps,
    finished: s.phase === 'ended',
    turns: s.turn.number,
    winner: winner ? winner.bot.difficulty : null,
    worth: Object.fromEntries(s.players.map((p) => [p.bot.difficulty, netWorth(s, p.id)])),
  };
}

// ---------------------------------------------------------------- CLI

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const games = Number(process.argv[2]) || 200;
  const mode = process.argv[3] || 'classic';
  const maxTurns = Number(process.argv[4]) || 0;
  const wins = { easy: 0, medium: 0, hard: 0, unfinished: 0 };
  let totalTurns = 0;
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    const r = simulateGame({ mode, maxTurns, seed: i + 1, maxSteps: 20_000 });
    wins[r.winner ?? 'unfinished']++;
    totalTurns += r.turns;
  }
  console.log(`${games} ${mode} games${maxTurns ? `, ${maxTurns}-turn limit` : ''} — easy vs medium vs hard`);
  for (const [k, v] of Object.entries(wins)) console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)}  (${Math.round((v / games) * 100)}%)`);
  console.log(`  avg turns  ${(totalTurns / games).toFixed(1)}   (${Date.now() - t0} ms)`);
}
