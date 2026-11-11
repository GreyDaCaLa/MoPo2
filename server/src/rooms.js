import { randomUUID, randomInt } from 'node:crypto';
import {
  createGame, addPlayer, removePlayer, startGame, applyAction, updateSettings, customizePlayer,
  endByTime, expireTurn, tickAuctions, nextAuctionDeadline, GameError,
  addBot, removeBot, setBotDifficulty, decideBotAction, botDelay,
} from '@mopo/shared';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 30 * 60 * 1000;

// Clients authenticate with a private `token` (kept in sessionStorage).
// Game state only ever exposes the public `playerId`.
export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> { state, idleTimer }
    this.sessions = new Map(); // token -> { playerId, code }
    this.sockets = new Map(); // socket.id -> token
  }

  get size() {
    return this.rooms.size;
  }

  newCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  // Strip anything clients shouldn't see (upcoming card order). `serverNow`
  // lets clients correct for clock skew when showing countdowns.
  // Sealed bid amounts are secret: clients only learn who has locked in.
  publicState(state) {
    const { decks, ...rest } = state;
    const auctions = state.auctions.map(({ bids, prevLeader, ...a }) =>
      a.format === 'sealed' ? { ...a, lockedIn: Object.keys(bids) } : a);
    return { ...rest, auctions, serverNow: Date.now() };
  }

  deleteRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    clearTimeout(room.idleTimer);
    clearTimeout(room.endTimer);
    clearTimeout(room.turnTimer);
    clearTimeout(room.botTimer);
    clearTimeout(room.auctionTimer);
    this.rooms.delete(code);
  }

  // End the game when its time limit runs out.
  scheduleEnd(code) {
    const room = this.rooms.get(code);
    if (!room?.state.endsAt) return;
    clearTimeout(room.endTimer);
    room.endTimer = setTimeout(() => {
      room.state = endByTime(room.state);
      this.broadcast(code);
    }, Math.max(0, room.state.endsAt - Date.now()));
  }

  // Keep a timer armed for the current turn deadline (turn-timer rule).
  scheduleTurnTimer(code) {
    const room = this.rooms.get(code);
    const deadline = room?.state.phase === 'playing' ? room.state.turn.deadline : null;
    if (room?.turnDeadline === deadline) return;
    clearTimeout(room.turnTimer);
    room.turnDeadline = deadline;
    if (!deadline) return;
    room.turnTimer = setTimeout(() => {
      room.turnDeadline = null;
      room.state = expireTurn(room.state, { now: Date.now() });
      this.broadcast(code);
    }, Math.max(0, deadline - Date.now()) + 50);
  }

  /**
   * Bot driver: one pending bot action per room at a time. When the timer
   * fires we re-ask the bots against the *current* state (it may have changed
   * while they were "thinking"), apply one action and broadcast, which
   * schedules the next. Bots pause while no human is connected.
   */
  scheduleBots(code) {
    const room = this.rooms.get(code);
    if (!room || room.botTimer || room.state.phase !== 'playing') return;
    if (!room.state.players.some((p) => !p.bot && p.connected)) return;
    const next = this.nextBotAction(room.state);
    if (!next) return;
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      const now = this.nextBotAction(room.state);
      if (now) {
        try {
          room.state = applyAction(room.state, now.bot.id, now.action, { now: Date.now() });
        } catch (err) {
          // A bot should never pick an illegal action; log it and let play continue.
          console.error(`[${code}] bot ${now.bot.name} ${JSON.stringify(now.action)}: ${err.message}`);
          room.botErrors = (room.botErrors || 0) + 1;
          if (room.botErrors > 20) return; // stop retrying a broken bot
        }
      }
      this.broadcast(code);
    }, botDelay(next.bot.bot.difficulty, next.action));
  }

  nextBotAction(state) {
    for (const bot of state.players) {
      if (!bot.bot || bot.bankrupt) continue;
      const action = decideBotAction(state, bot.id);
      if (action) return { bot, action };
    }
    return null;
  }

  // Close live auctions when their countdown runs out.
  scheduleAuctionTimer(code) {
    const room = this.rooms.get(code);
    const deadline = room ? nextAuctionDeadline(room.state) : null;
    if (room?.auctionDeadline === deadline) return;
    clearTimeout(room.auctionTimer);
    room.auctionDeadline = deadline;
    if (deadline == null) return;
    room.auctionTimer = setTimeout(() => {
      room.auctionDeadline = null;
      room.state = tickAuctions(room.state, { now: Date.now() });
      this.broadcast(code);
    }, Math.max(0, deadline - Date.now()) + 30);
  }

  broadcast(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    this.scheduleTurnTimer(code);
    this.scheduleAuctionTimer(code);
    this.scheduleBots(code);
    this.io.to(code).emit('state', this.publicState(room.state));
  }

  setConnected(code, playerId, connected) {
    const room = this.rooms.get(code);
    if (!room) return;
    const p = room.state.players.find((x) => x.id === playerId);
    if (p) p.connected = connected;
    const anyone = room.state.players.some((x) => x.connected && !x.bot);
    clearTimeout(room.idleTimer);
    if (!anyone) {
      room.idleTimer = setTimeout(() => this.deleteRoom(code), ROOM_IDLE_MS);
    }
  }

  join(socket, token, code, playerId) {
    this.sessions.set(token, { playerId, code });
    this.sockets.set(socket.id, token);
    socket.join(code);
    this.setConnected(code, playerId, true);
    this.broadcast(code);
  }

  attach(socket) {
    const handle = (fn) => (payload, ack = () => {}) => {
      try {
        ack({ ok: true, ...(fn(payload || {}) || {}) });
      } catch (err) {
        if (!(err instanceof GameError)) console.error(err);
        ack({ ok: false, error: err instanceof GameError ? err.message : 'Server error' });
      }
    };

    const session = () => {
      const token = this.sockets.get(socket.id);
      const s = token && this.sessions.get(token);
      if (!s || !this.rooms.has(s.code)) throw new GameError('Not in a room');
      return { ...s, room: this.rooms.get(s.code) };
    };

    // Resume a previous session after a refresh / reconnect.
    socket.on('hello', handle(({ token }) => {
      const s = token && this.sessions.get(token);
      if (!s || !this.rooms.has(s.code)) return { resumed: false };
      this.join(socket, token, s.code, s.playerId);
      return { resumed: true, code: s.code, playerId: s.playerId };
    }));

    socket.on('room:create', handle(({ name }) => {
      const code = this.newCode();
      const token = randomUUID();
      const playerId = randomUUID().slice(0, 8);
      this.rooms.set(code, { state: addPlayer(createGame(code), playerId, name) });
      this.join(socket, token, code, playerId);
      return { code, playerId, token };
    }));

    socket.on('room:join', handle(({ code, name }) => {
      code = String(code || '').toUpperCase().trim();
      const room = this.rooms.get(code);
      if (!room) throw new GameError('Room not found');
      const token = randomUUID();
      const playerId = randomUUID().slice(0, 8);
      room.state = addPlayer(room.state, playerId, name);
      this.join(socket, token, code, playerId);
      return { code, playerId, token };
    }));

    socket.on('room:leave', handle(() => {
      const { code, playerId, room } = session();
      const token = this.sockets.get(socket.id);
      room.state = removePlayer(room.state, playerId); // no-op once the game started
      if (room.state.phase !== 'lobby') this.setConnected(code, playerId, false);
      this.sessions.delete(token);
      this.sockets.delete(socket.id);
      socket.leave(code);
      if (!room.state.players.some((p) => !p.bot)) this.deleteRoom(code); // only bots left
      else this.broadcast(code);
    }));

    socket.on('game:start', handle(() => {
      const { code, playerId, room } = session();
      room.state = startGame(room.state, playerId);
      this.scheduleEnd(code);
      this.broadcast(code);
    }));

    socket.on('room:settings', handle((patch) => {
      const { code, playerId, room } = session();
      room.state = updateSettings(room.state, playerId, patch);
      this.broadcast(code);
    }));

    socket.on('player:customize', handle(({ token, color }) => {
      const { code, playerId, room } = session();
      room.state = customizePlayer(room.state, playerId, { token, color });
      this.broadcast(code);
    }));

    socket.on('bot:add', handle(({ difficulty }) => {
      const { code, playerId, room } = session();
      room.state = addBot(room.state, playerId, difficulty);
      this.broadcast(code);
    }));

    socket.on('bot:remove', handle(({ id }) => {
      const { code, playerId, room } = session();
      room.state = removeBot(room.state, playerId, id);
      this.broadcast(code);
    }));

    socket.on('bot:difficulty', handle(({ id, difficulty }) => {
      const { code, playerId, room } = session();
      room.state = setBotDifficulty(room.state, playerId, id, difficulty);
      this.broadcast(code);
    }));

    socket.on('game:action', handle((action) => {
      const { code, playerId, room } = session();
      room.state = applyAction(room.state, playerId, action, { now: Date.now() });
      this.broadcast(code);
    }));

    socket.on('disconnect', () => {
      const token = this.sockets.get(socket.id);
      this.sockets.delete(socket.id);
      const s = token && this.sessions.get(token);
      if (!s) return;
      this.setConnected(s.code, s.playerId, false);
      this.broadcast(s.code);
    });
  }
}
