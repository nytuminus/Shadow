// Núcleo em tempo real do escritório 2D: posição dos avatares + proximidade.
// Anexado ao MESMO httpServer que o Express já usa (sem porta nova); o
// Socket.io ocupa o path padrão /socket.io, que não conflita com o /ws das
// Salas (esse aqui substitui o /ws quando a Fase 10 fizer o corte).

import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  Direction,
  InterServerEvents,
  PlayerState,
  ServerToClientEvents,
  SocketData,
} from '@shadow/shared';
import { verifyToken } from './auth.js';
import { removePlayer as removeFromProximity, updateProximity } from './proximity.js';

const MAP_ID = 'escritorio'; // único mapa no MVP; o campo já existe pra quando houver mais
const TICK_MS = 100; // ~10Hz — throttle tanto do broadcast quanto da checagem de proximidade

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const isDirection = (v: unknown): v is Direction => DIRECTIONS.includes(v as Direction);

type OfficeServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type OfficeSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const players = new Map<string, PlayerState>(); // socketId -> estado

export function attachOfficeSocket(httpServer: HttpServer): OfficeServer {
  const io: OfficeServer = new SocketIOServer(httpServer, { path: '/socket.io' });

  // Autentica no handshake — mesma verificação do middleware Express, mas o
  // Socket.io não usa header Authorization, e sim `auth.token` na conexão.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Não autenticado.'));
    try {
      const payload = verifyToken(String(token));
      socket.data.employeeId = payload.sub;
      socket.data.username = payload.username;
      socket.data.name = payload.name;
      socket.data.mapId = MAP_ID;
      next();
    } catch {
      next(new Error('Token inválido ou expirado.'));
    }
  });

  io.on('connection', (socket: OfficeSocket) => {
    const player: PlayerState = {
      socketId: socket.id,
      employeeId: socket.data.employeeId,
      username: socket.data.username,
      name: socket.data.name,
      mapId: MAP_ID,
      x: 0,
      y: 0,
      direction: 'down',
      moving: false,
    };
    players.set(socket.id, player);
    socket.join(MAP_ID);

    socket.on('player:move', (payload) => {
      const p = players.get(socket.id);
      if (!p) return;
      p.x = Number(payload?.x) || 0;
      p.y = Number(payload?.y) || 0;
      p.direction = isDirection(payload?.direction) ? payload.direction : p.direction;
      p.moving = !!payload?.moving;
    });

    socket.on('disconnect', () => {
      players.delete(socket.id);
      const changes = removeFromProximity(socket.id);
      for (const c of changes) notifyProximity(io, c);
      io.to(MAP_ID).emit('player:left', { socketId: socket.id });
    });
  });

  setInterval(() => {
    broadcastSnapshots(io);
    const changes = updateProximity([...players.values()]);
    for (const c of changes) notifyProximity(io, c);
  }, TICK_MS);

  return io;
}

function broadcastSnapshots(io: OfficeServer): void {
  const byMap = new Map<string, PlayerState[]>();
  for (const p of players.values()) {
    if (!byMap.has(p.mapId)) byMap.set(p.mapId, []);
    byMap.get(p.mapId)!.push(p);
  }
  for (const [mapId, list] of byMap) {
    io.to(mapId).emit('players:snapshot', list);
  }
}

function notifyProximity(io: OfficeServer, change: { a: string; b: string; type: 'enter' | 'leave' }): void {
  const event = change.type === 'enter' ? 'proximity:enter' : 'proximity:leave';
  io.to(change.a).emit(event, { peerId: change.b });
  io.to(change.b).emit(event, { peerId: change.a });
}
