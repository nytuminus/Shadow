// Adaptador de banco em ARQUIVO (JSON). É o fallback que roda sem nenhuma
// configuração: guarda salas, canais, mensagens e usuários num único arquivo
// em apps/server/data (ou %APPDATA%\Shadow\data no app instalado).
//
// Ele existe pra plataforma subir na hora, mesmo antes de você apontar o
// MySQL da Hostinger. A interface pública é a MESMA do adaptador MySQL
// (db/mysql-store.ts), então trocar um pelo outro não mexe nas rotas.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { dataFile, ensureDataDir } from '../data-dir.js';
import type { DbChannel, DbMessage, DbRoom, DbStore, DbUser, Employee } from './types.js';

interface JsonDb {
  rooms: DbRoom[];
  channels: DbChannel[];
  messages: DbMessage[];
  users: DbUser[];
}

const FILE = () => dataFile('community.json');

const empty = (): JsonDb => ({ rooms: [], channels: [], messages: [], users: [] });

let cache: JsonDb | null = null;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

async function load(): Promise<JsonDb> {
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
  return cache!;
}

// Grava com um pequeno atraso pra não bater no disco a cada mensagem.
function persist(): void {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    try {
      await ensureDataDir();
      await writeFile(FILE(), JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
      console.error('[db-json] gravação falhou:', err instanceof Error ? err.message : err);
    }
  }, 250);
}

// Funcionários (login) ficam num arquivo à parte — é credencial, não dado de
// chat, e assim segue o mesmo padrão dos outros arquivos soltos (reminders,
// commands...) em vez de inchar o community.json.
const EMPLOYEES_FILE = () => dataFile('employees.json');
let employeesCache: Employee[] | null = null;
let employeesWriteTimer: ReturnType<typeof setTimeout> | undefined;

async function loadEmployees(): Promise<Employee[]> {
  if (employeesCache) return employeesCache;
  await ensureDataDir();
  try {
    employeesCache = existsSync(EMPLOYEES_FILE())
      ? JSON.parse(await readFile(EMPLOYEES_FILE(), 'utf8'))
      : [];
  } catch {
    employeesCache = [];
  }
  return employeesCache!;
}

function persistEmployees(): void {
  clearTimeout(employeesWriteTimer);
  employeesWriteTimer = setTimeout(async () => {
    try {
      await ensureDataDir();
      await writeFile(EMPLOYEES_FILE(), JSON.stringify(employeesCache, null, 2), 'utf8');
    } catch (err) {
      console.error('[db-json] gravação de employees falhou:', err instanceof Error ? err.message : err);
    }
  }, 250);
}

const now = () => new Date().toISOString();

export const jsonStore: DbStore = {
  kind: 'json',

  async init() {
    const db = await load();
    // Semente: se não existe nenhuma sala, cria uma "Empresa" com canais base.
    if (db.rooms.length === 0) {
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
    const user: DbUser = { id: uid, name, avatar, color, updatedAt: now() };
    if (existing) Object.assign(existing, user);
    else db.users.push(user);
    persist();
    return user;
  },
  async getUser(id) {
    const db = await load();
    return db.users.find((u) => u.id === id) || null;
  },

  // ---- Funcionários (login) ----
  async createEmployee({ username, name, passwordHash }) {
    const employees = await loadEmployees();
    const employee: Employee = { id: nanoid(10), username, name, passwordHash, createdAt: now() };
    employees.push(employee);
    persistEmployees();
    return employee;
  },
  async getEmployeeByUsername(username) {
    const employees = await loadEmployees();
    return employees.find((e) => e.username === username) || null;
  },
  async listEmployees() {
    return loadEmployees();
  },

  // ---- Salas (servidores) ----
  async createRoom({ name, icon = '💬', color = '#8b7bff' }) {
    const db = await load();
    const room: DbRoom = { id: nanoid(10), name, icon, color, createdAt: now() };
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
    const channel: DbChannel = { id: nanoid(10), roomId, name, type: type === 'voice' ? 'voice' : 'text', position, createdAt: now() };
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
  async addMessage(channelId, { userId = null, userName = null, text }) {
    const db = await load();
    const msg: DbMessage = { id: nanoid(12), channelId, userId, userName, text, createdAt: now() };
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
