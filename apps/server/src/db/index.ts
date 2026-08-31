// Camada de banco da plataforma Shadow — ponto único de acesso.
//
// Escolhe o adaptador automaticamente:
//   • MySQL (Hostinger)  → se houver MYSQL_* ou DATABASE_URL no .env;
//   • JSON (arquivo)     → caso contrário, pra plataforma subir sem config.
//
// As rotas e a sinalização só falam com `db` — trocar o backend de dados é
// só preencher as variáveis do MySQL e reiniciar. Nada mais muda.

import { jsonStore } from './json-store.js';
import { makeMysqlStore, mysqlConfigured } from './mysql-store.js';
import type { DbStore } from './types.js';

let store: DbStore | null = null;

export async function initDb(): Promise<DbStore> {
  if (store) return store;
  if (mysqlConfigured()) {
    try {
      store = await makeMysqlStore().init();
      console.log('     Banco: MySQL (Hostinger) conectado');
      return store;
    } catch (err) {
      console.error('[db] MySQL falhou, caindo pro arquivo local:', err instanceof Error ? err.message : err);
    }
  }
  store = await jsonStore.init();
  console.log(`     Banco: arquivo local (JSON)${mysqlConfigured() ? ' — reserva' : ''}`);
  return store;
}

/** Acesso ao banco já inicializado. */
export function db(): DbStore {
  if (!store) throw new Error('Banco ainda não foi inicializado (chame initDb).');
  return store;
}

export type { DbStore, DbUser, DbRoom, DbChannel, DbMessage, ChannelType, Employee } from './types.js';
