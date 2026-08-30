// API REST da área "Salas" — salas (servidores), canais e histórico de chat.
// As mensagens novas em tempo real chegam pelo WebSocket; aqui é o CRUD e o
// carregamento do histórico. Também expõe a configuração de ICE (STUN/TURN)
// que o navegador precisa pra montar as chamadas WebRTC.

import { Router } from 'express';
import { db } from '../db/index.js';

export const communityRouter = Router();

// Servidores ICE para o WebRTC. STUN público por padrão; o TURN (necessário
// pra atravessar firewalls/NAT quando as pessoas estão em redes diferentes)
// entra por .env quando você subir um servidor TURN na VPS.
communityRouter.get('/rtc-config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  }
  res.json({ iceServers });
});

// ---- Salas ----
communityRouter.get('/rooms', async (req, res) => {
  const rooms = await db().listRooms();
  // Já embute os canais de cada sala pra economizar ida e volta.
  const full = await Promise.all(
    rooms.map(async (r) => ({ ...r, channels: await db().listChannels(r.id) }))
  );
  res.json(full);
});

communityRouter.post('/rooms', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
  const room = await db().createRoom({
    name: name.slice(0, 60),
    icon: req.body?.icon || '💬',
    color: req.body?.color || '#8b7bff',
  });
  res.json(room);
});

communityRouter.put('/rooms/:id', async (req, res) => {
  const room = await db().updateRoom(req.params.id, req.body || {});
  if (!room) return res.status(404).json({ error: 'Sala não encontrada.' });
  res.json(room);
});

communityRouter.delete('/rooms/:id', async (req, res) => {
  res.json({ ok: await db().deleteRoom(req.params.id) });
});

// ---- Canais ----
communityRouter.post('/rooms/:id/channels', async (req, res) => {
  const room = await db().getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Sala não encontrada.' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
  const channel = await db().createChannel(room.id, {
    name: name.slice(0, 60),
    type: req.body?.type === 'voice' ? 'voice' : 'text',
  });
  res.json(channel);
});

communityRouter.delete('/channels/:id', async (req, res) => {
  res.json({ ok: await db().deleteChannel(req.params.id) });
});

// ---- Histórico de chat de um canal ----
communityRouter.get('/channels/:id/messages', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(await db().listMessages(req.params.id, limit));
});
