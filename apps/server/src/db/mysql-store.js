// Adaptador de banco MySQL (produção / multiusuário) — mesma interface do
// adaptador JSON (server/db/json-store.js). Usa mysql2/promise com pool de
// conexões. Ativado quando as variáveis MYSQL_* (ou DATABASE_URL) existem
// no .env — veja server/db/index.js.
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

let mysql = null; // carregado sob demanda pra não pesar quando usamos JSON

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

export function mysqlConfigured() {
  return !!(process.env.DATABASE_URL || (process.env.MYSQL_HOST && process.env.MYSQL_DATABASE));
}

export function makeMysqlStore() {
  let pool = null;

  async function q(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  const store = {
    kind: 'mysql',

    async init() {
      ({ default: mysql } = await import('mysql2/promise'));
      const cfg = readConfig();
      pool = mysql.createPool(
        cfg.uri
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
      const rows = await q('SELECT * FROM users WHERE id=?', [id]);
      return rows[0] || null;
    },

    async createRoom({ name, icon = '💬', color = '#8b7bff' }) {
      const id = nanoid(10);
      const ts = new Date();
      await q('INSERT INTO rooms (id,name,icon,color,createdAt) VALUES (?,?,?,?,?)', [id, name, icon, color, ts]);
      return { id, name, icon, color, createdAt: ts.toISOString() };
    },
    async listRooms() {
      return q('SELECT * FROM rooms ORDER BY createdAt ASC');
    },
    async getRoom(id) {
      const rows = await q('SELECT * FROM rooms WHERE id=?', [id]);
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
      const [{ n }] = await q('SELECT COUNT(*) AS n FROM channels WHERE roomId=?', [roomId]);
      const position = Number(n) || 0;
      const t = type === 'voice' ? 'voice' : 'text';
      await q('INSERT INTO channels (id,roomId,name,type,position,createdAt) VALUES (?,?,?,?,?,?)', [id, roomId, name, t, position, ts]);
      return { id, roomId, name, type: t, position, createdAt: ts.toISOString() };
    },
    async listChannels(roomId) {
      return q('SELECT * FROM channels WHERE roomId=? ORDER BY position ASC', [roomId]);
    },
    async getChannel(id) {
      const rows = await q('SELECT * FROM channels WHERE id=?', [id]);
      return rows[0] || null;
    },
    async deleteChannel(id) {
      await q('DELETE FROM channels WHERE id=?', [id]);
      return true;
    },

    async addMessage(channelId, { userId, userName, text }) {
      const id = nanoid(12);
      const ts = new Date();
      await q('INSERT INTO messages (id,channelId,userId,userName,text,createdAt) VALUES (?,?,?,?,?,?)', [id, channelId, userId || null, userName || null, text, ts]);
      return { id, channelId, userId, userName, text, createdAt: ts.toISOString() };
    },
    async listMessages(channelId, limit = 50) {
      const rows = await q('SELECT * FROM messages WHERE channelId=? ORDER BY createdAt DESC LIMIT ?', [channelId, Number(limit)]);
      return rows.reverse();
    },
  };

  return store;
}
