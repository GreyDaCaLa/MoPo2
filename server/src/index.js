import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CLIENT_ORIGIN } });
const rooms = new RoomManager(io);

app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// In production, serve the built client from the same origin (one Render service).
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

io.on('connection', (socket) => rooms.attach(socket));

httpServer.listen(PORT, () => {
  console.log(`MoPo server listening on http://localhost:${PORT}`);
});
