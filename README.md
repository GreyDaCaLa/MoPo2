# MoPo

An original multiplayer property-trading board game set in **Port Mopo**:
roll, buy streets, collect rent, build houses, and bankrupt your friends.
Built with React + React Three Fiber on the client and a Node / Socket.IO server.

## Layout

```
shared/   board data (spaces, groups, cards) + pure rules engine (+ tests)
server/   Express + Socket.IO; owns all game state, rooms with 4-letter codes
client/   Vite + React 19 + @react-three/fiber 9 + drei 10 + zustand
```

The server is authoritative: clients send intents (`{ type: 'roll' }`, `{ type: 'build', index }` …),
the server runs them through `shared/src/engine.js`, and broadcasts the new public state
(upcoming card order is stripped out).

## Running locally

```bash
npm install
npm run dev        # server on :3001, client on http://localhost:5173 (proxied)
npm test           # engine tests
```

To play against yourself, open two **separate tabs**. Each tab keeps its own session in
`sessionStorage`, so a refresh rejoins the same seat.

## Deploying (single service, e.g. Render)

```bash
npm install && npm run build   # build command
npm start                      # start command — serves client/dist + websockets on $PORT
```

To host the client separately (e.g. Netlify), build it with `VITE_SERVER_URL=https://your-server`
and set `CLIENT_ORIGIN` on the server to the client's URL for CORS.

## Room setup

After creating or joining a room, everyone lands on the setup page:

- **Your piece** — pick a unique token (3D models in `client/src/three/TokenModel.jsx`) and color.
- **Rules** — the host picks; everyone else sees them update live. Rules are defined once in
  `shared/src/settings.js` (`RULES`). The server validates against that list and the setup page
  renders it automatically, so adding a rule = one entry there + handling it in the engine.

## Game architecture: turns, actions, prompts

The engine (`shared/src/engine.js`) is built on three concepts:

- **Turns** — the board's clock (`state.turn.number`). Players press **Ready** to say "I'm done,
  ready to roll". When everyone who should roll is ready, their dice roll together, all pieces move
  at once, then landings resolve in seat order.
- **Actions** — optional, player-initiated, never block the game: build, sell, mortgage,
  bankruptcy (later: trading). Allowed any time.
- **Prompts** — the game asking one player for a decision (`state.prompts`): buy/pass, how to
  leave Lockup, a drawn card (later: auctions, trade responses). You can't ready up with one open.
  Each prompt kind has a default used when the turn timer runs out.

```
Turn N
 ├─ everyone readies → all dice roll at once → all pieces move together
 ├─ landings resolve → prompts
 ├─ doubles? those players ready again → roll together → move → resolve (3rd doubles = Lockup)
 └─ everyone answers prompts, does actions, presses Ready → Turn N+1 starts rolling
```

## Game modes

- **Classic** — the same flow with one roller at a time, in seat order. Ready is labelled
  "Roll dice" / "Roll again" / "End turn". The turn number counts full rounds.
- **Party** — everyone rolls together each turn. If two players land on the same unowned street,
  both are offered it and the first to buy wins (auctions will replace this).

Keys: Space = ready/roll, B = buy, P = pass, Enter = acknowledge card.

## Rules implemented

- 2–6 players; starting money and Start salary configurable
- House rules: double salary for landing on Start, Harbor Rest jackpot
- Game length: turn limit and/or time limit (richest by net worth wins); optional turn timer
- Buy / pass on unowned spaces; rent doubles on an unbuilt full color group
- Transit (25/50/100/200) and utilities (4× / 10× dice)
- Even building of houses → hotel, selling buildings, mortgaging (+10% to lift)
- Lockup: three doubles, "Busted!" corner, cards; leave by doubles, $50 bail, or a card
- Fortune and City Hall card decks
- Debt → raise money or declare bankruptcy (assets go to the creditor); last player standing wins

### Not yet

Auctions for passed properties, player-to-player trading, turn timers / kicking idle players,
house/hotel supply limits, persistence across server restarts.

## Credits

Dice model from "Monopoly" (https://sketchfab.com/3d-models/monopoly-2f0ff1f2cd184f2d8fd3215b5d339199)
by Anthony Yanez (https://sketchfab.com/paulyanez), licensed under CC-BY-4.0. Only the dice
mesh is used; see `client/public/models/dice/LICENSE.txt`.
