// Adaptador de banco MySQL (produção / multiusuário) — mesma interface do
// adaptador JSON (db/json-store.ts). Usa mysql2/promise com pool de
// conexões. Ativado quando as variáveis MYSQL_* (ou DATABASE_URL) existem
// no .env — veja db/index.ts.
//
// Credenciais esperadas no .env:
//   MYSQL_HOST=...        (ex.: painel da Hostinger)
//   MYSQL_PORT=3306
//   MYSQL_USER=...
//   MYSQL_PASSWORD=...
//   MYSQL_DATABASE=...
// ou, alternativamente:
//   DATABASE_URL=mysql://user:pass@host:3306/dbname

import { nanoid } from 'nanoid';
import type { Pool } from 'mysql2/promise';
import type { ChannelType, DbChannel, DbMessage, DbRoom, DbStore, DbUser, Employee } from './types.js';

function readConfig() {
  if (process.env.DATABASE_URL) {
    return { uri: process.env.DATABASE_URL };
  }
  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  };
}

export function mysqlConfigured(): boolean {
  return !!(process.env.DATABASE_URL || (process.env.MYSQL_HOST && process.env.MYSQL_DATABASE));
}

export function makeMysqlStore(): DbStore {
  let pool: Pool;

  async function q<T>(sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await pool.execute(sql, params);
    return rows as T[];
  }

  const store: DbStore = {
    kind: 'mysql',

    async init() {
      const { default: mysql } = await import('mysql2/promise');
      const cfg = readConfig();
      pool = mysql.createPool(
        'uri' in cfg
          ? { uri: cfg.uri, waitForConnections: true, connectionLimit: 10, namedPlaceholders: false }
          : { ...cfg, waitForConnections: true, connectionLimit: 10 }
      );

      // Cria as tabelas se ainda não existirem (idempotente).
      await q(`CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(24) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        avatar TEXT,
        color VARCHAR(16),
        updatedAt DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await q(`CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(24) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        icon VARCHAR(16),
        color VARCHAR(16),
        createdAt DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await q(`CREATE TABLE IF NOT EXISTS channels (
        id VARCHAR(24) PRIMARY KEY,
        roomId VARCHAR(24) NOT NULL,
        name VARCHAR(120) NOT NULL,
        type ENUM('text','voice') NOT NULL DEFAULT 'text',
        position INT NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL,
        INDEX idx_room (roomId),
        FOREIGN KEY (roomId) REFERENCES rooms(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await q(`CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(24) PRIMARY KEY,
        channelId VARCHAR(24) NOT NULL,
        userId VARCHAR(24),
        userName VARCHAR(120),
        text TEXT NOT NULL,
        createdAt DATETIME NOT NULL,
        INDEX idx_channel (channelId, createdAt),
        FOREIGN KEY (channelId) REFERENCES channels(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      await q(`CREATE TABLE IF NOT EXISTS employees (
        id VARCHAR(24) PRIMARY KEY,
        username VARCHAR(60) NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL,
        passwordHash VARCHAR(120) NOT NULL,
        createdAt DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

      // Semente inicial.
      const rooms = await q('SELECT id FROM rooms LIMIT 1');
      if (rooms.length === 0) {
        const room = await this.createRoom({ name: 'Empresa', icon: '🏢', color: '#8b7bff' });
        await this.createChannel(room.id, { name: 'geral', type: 'text' });
        await this.createChannel(room.id, { name: 'avisos', type: 'text' });
        await this.createChannel(room.id, { name: 'Sala de Reunião', type: 'voice' });
        await this.createChannel(room.id, { name: 'Sala Livre', type: 'voice' });
      }
      return this;
    },

    async upsertUser({ id, name, avatar = '', color = '' }) {
      const uid = id || nanoid(10);
      const ts = new Date();
      await q(
        `INSERT INTO users (id,name,avatar,color,updatedAt) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), avatar=VALUES(avatar), color=VALUES(color), updatedAt=VALUES(updatedAt)`,
        [uid, name, avatar, color, ts]
      );
      return { id: uid, name, avatar, color, updatedAt: ts.toISOString() };
    },
    async getUser(id) {
      const rows = await q<DbUser>('SELECT * FROM users WHERE id=?', [id]);
      return rows[0] || null;
    },

    async createEmployee({ username, name, passwordHash }) {
      const id = nanoid(10);
      const ts = new Date();
      await q('INSERT INTO employees (id,username,name,passwordHash,createdAt) VALUES (?,?,?,?,?)', [id, username, name, passwordHash, ts]);
      return { id, username, name, passwordHash, createdAt: ts.toISOString() };
    },
    async getEmployeeByUsername(username) {
      const rows = await q<Employee>('SELECT * FROM employees WHERE username=?', [username]);
      return rows[0] || null;
    },
    async listEmployees() {
      return q<Employee>('SELECT * FROM employees ORDER BY createdAt ASC');
    },

    async createRoom({ name, icon = '💬', color = '#8b7bff' }) {
      const id = nanoid(10);
      const ts = new Date();
      await q('INSERT INTO rooms (id,name,icon,color,createdAt) VALUES (?,?,?,?,?)', [id, name, icon, color, ts]);
      return { id, name, icon, color, createdAt: ts.toISOString() };
    },
    async listRooms() {
      return q<DbRoom>('SELECT * FROM rooms ORDER BY createdAt ASC');
    },
    async getRoom(id) {
      const rows = await q<DbRoom>('SELECT * FROM rooms WHERE id=?', [id]);
      return rows[0] || null;
    },
    async updateRoom(id, patch) {
      const cur = await this.getRoom(id);
      if (!cur) return null;
      await q('UPDATE rooms SET name=?, icon=?, color=? WHERE id=?', [
        patch.name ?? cur.name, patch.icon ?? cur.icon, patch.color ?? cur.color, id,
      ]);
      return this.getRoom(id);
    },
    async deleteRoom(id) {
      await q('DELETE FROM rooms WHERE id=?', [id]);
      return true;
    },

    async createChannel(roomId, { name, type = 'text' }) {
      const id = nanoid(10);
      const ts = new Date();
      const rows = await q<{ n: number }>('SELECT COUNT(*) AS n FROM channels WHERE roomId=?', [roomId]);
      const position = Number(rows[0]?.n) || 0;
      const t: ChannelType = type === 'voice' ? 'voice' : 'text';
      await q('INSERT INTO channels (id,roomId,name,type,position,createdAt) VALUES (?,?,?,?,?,?)', [id, roomId, name, t, position, ts]);
      return { id, roomId, name, type: t, position, createdAt: ts.toISOString() };
    },
    async listChannels(roomId) {
      return q<DbChannel>('SELECT * FROM channels WHERE roomId=? ORDER BY position ASC', [roomId]);
    },
    async getChannel(id) {
      const rows = await q<DbChannel>('SELECT * FROM channels WHERE id=?', [id]);
      return rows[0] || null;
    },
    async deleteChannel(id) {
      await q('DELETE FROM channels WHERE id=?', [id]);
      return true;
    },

    async addMessage(channelId, { userId = null, userName = null, text }) {
      const id = nanoid(12);
      const ts = new Date();
      await q('INSERT INTO messages (id,channelId,userId,userName,text,createdAt) VALUES (?,?,?,?,?,?)', [id, channelId, userId, userName, text, ts]);
      return { id, channelId, userId, userName, text, createdAt: ts.toISOString() };
    },
    async listMessages(channelId, limit = 50) {
      const rows = await q<DbMessage>('SELECT * FROM messages WHERE channelId=? ORDER BY createdAt DESC LIMIT ?', [channelId, Number(limit)]);
      return rows.reverse();
    },
  };

  return store;
}
