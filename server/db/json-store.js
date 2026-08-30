// Adaptador de banco em ARQUIVO (JSON). É o fallback que roda sem nenhuma
// configuração: guarda salas, canais, mensagens e usuários num único arquivo
// em server/data (ou %APPDATA%\Shadow\data no app instalado).
//
// Ele existe pra plataforma subir na hora, mesmo antes de você apontar o
// MySQL da Hostinger. A interface pública é a MESMA do adaptador MySQL
// (server/db/mysql-store.js), então trocar um pelo outro não mexe nas rotas.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { dataFile, ensureDataDir } from '../data-dir.js';

const FILE = () => dataFile('community.json');

const empty = () => ({ rooms: [], channels: [], messages: [], users: [] });

let cache = null;
let writeTimer = null;

async function load() {
  if (cache) return cache;
  await ensureDataDir();
  try {
    if (existsSync(FILE())) {
      cache = { ...empty(), ...JSON.parse(await readFile(FILE(), 'utf8')) };
    } else {
      cache = empty();
    }
  } catch {
    cache = empty();
  }
  return cache;
}

// Grava com um pequeno atraso pra não bater no disco a cada mensagem.
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    try {
      await ensureDataDir();
      await writeFile(FILE(), JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
      console.error('[db-json] gravação falhou:', err?.message || err);
    }
  }, 250);
}

const now = () => new Date().toISOString();

export const jsonStore = {
  kind: 'json',

  async init() {
    await load();
    // Semente: se não existe nenhuma sala, cria uma "Empresa" com canais base.
    if (cache.rooms.length === 0) {
      const room = await this.createRoom({ name: 'Empresa', icon: '🏢', color: '#8b7bff' });
      await this.createChannel(room.id, { name: 'geral', type: 'text' });
      await this.createChannel(room.id, { name: 'avisos', type: 'text' });
      await this.createChannel(room.id, { name: 'Sala de Reunião', type: 'voice' });
      await this.createChannel(room.id, { name: 'Sala Livre', type: 'voice' });
    }
    return this;
  },

  // ---- Usuários ----
  async upsertUser({ id, name, avatar = '', color = '' }) {
    const db = await load();
    const uid = id || nanoid(10);
    const existing = db.users.find((u) => u.id === uid);
    const user = { id: uid, name, avatar, color, updatedAt: now() };
    if (existing) Object.assign(existing, user);
    else db.users.push(user);
    persist();
    return user;
  },
  async getUser(id) {
    const db = await load();
    return db.users.find((u) => u.id === id) || null;
  },

  // ---- Salas (servidores) ----
  async createRoom({ name, icon = '💬', color = '#8b7bff' }) {
    const db = await load();
    const room = { id: nanoid(10), name, icon, color, createdAt: now() };
    db.rooms.push(room);
    persist();
    return room;
  },
  async listRooms() {
    const db = await load();
    return [...db.rooms].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async getRoom(id) {
    const db = await load();
    return db.rooms.find((r) => r.id === id) || null;
  },
  async updateRoom(id, patch) {
    const db = await load();
    const room = db.rooms.find((r) => r.id === id);
    if (!room) return null;
    Object.assign(room, { name: patch.name ?? room.name, icon: patch.icon ?? room.icon, color: patch.color ?? room.color });
    persist();
    return room;
  },
  async deleteRoom(id) {
    const db = await load();
    db.rooms = db.rooms.filter((r) => r.id !== id);
    const chans = db.channels.filter((c) => c.roomId === id).map((c) => c.id);
    db.channels = db.channels.filter((c) => c.roomId !== id);
    db.messages = db.messages.filter((m) => !chans.includes(m.channelId));
    persist();
    return true;
  },

  // ---- Canais ----
  async createChannel(roomId, { name, type = 'text' }) {
    const db = await load();
    const position = db.channels.filter((c) => c.roomId === roomId).length;
    const channel = { id: nanoid(10), roomId, name, type: type === 'voice' ? 'voice' : 'text', position, createdAt: now() };
    db.channels.push(channel);
    persist();
    return channel;
  },
  async listChannels(roomId) {
    const db = await load();
    return db.channels
      .filter((c) => c.roomId === roomId)
      .sort((a, b) => a.position - b.position);
  },
  async getChannel(id) {
    const db = await load();
    return db.channels.find((c) => c.id === id) || null;
  },
  async deleteChannel(id) {
    const db = await load();
    db.channels = db.channels.filter((c) => c.id !== id);
    db.messages = db.messages.filter((m) => m.channelId !== id);
    persist();
    return true;
  },

  // ---- Mensagens (chat de texto por canal) ----
  async addMessage(channelId, { userId, userName, text }) {
    const db = await load();
    const msg = { id: nanoid(12), channelId, userId, userName, text, createdAt: now() };
    db.messages.push(msg);
    // Mantém no máximo 500 mensagens por canal no arquivo local.
    const doCanal = db.messages.filter((m) => m.channelId === channelId);
    if (doCanal.length > 500) {
      const excedente = doCanal.slice(0, doCanal.length - 500).map((m) => m.id);
      db.messages = db.messages.filter((m) => !excedente.includes(m.id));
    }
    persist();
    return msg;
  },
  async listMessages(channelId, limit = 50) {
    const db = await load();
    return db.messages
      .filter((m) => m.channelId === channelId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit);
  },
};
