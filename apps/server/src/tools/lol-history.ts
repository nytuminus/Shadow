// Histórico de partidas do LoL — guarda o retrospecto de cada jogo em disco,
// no mesmo padrão dos lembretes/comandos (apps/server/data/lol-history.json).

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dataFile, ensureDataDir } from '../data-dir.js';

const FILE = dataFile('lol-history.json');
const MAX = 60; // mantém as últimas 60 partidas

// Registro bem livre: o retrospecto (brain.ts/lolPostGame) guarda dezenas de
// campos numéricos/derivados que mudam com o tempo — id/date são os únicos
// garantidos, o resto é o que a análise daquele momento produziu.
export interface HistoryEntry {
  id: string;
  date: string;
  [key: string]: unknown;
}

let history: HistoryEntry[] = [];

async function persist(): Promise<void> {
  await ensureDataDir();
  await writeFile(FILE, JSON.stringify(history, null, 2), 'utf8');
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    await ensureDataDir();
    if (existsSync(FILE)) history = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    history = [];
  }
  if (repararNumerosImpossiveis()) await persist();
  return history;
}

// Um time tem no máximo 11 torres e 3 inibidores. Partidas gravadas antes da
// correção guardaram coisas como "0 × 16": números que o jogo não permite.
// Aqui eles viram "n/d" — some da tela e some do que a IA lê para reanalisar.
const LIMITES: [string, string, number][] = [
  ['towersAlly', 'towersEnemy', 11],
  ['dragons', 'dragonsEnemy', 12],
  ['barons', 'baronsEnemy', 10],
];

function repararNumerosImpossiveis(): boolean {
  let mexeu = false;
  for (const h of history) {
    for (const [meu, dele, max] of LIMITES) {
      if ((h[meu] as number) > max || (h[dele] as number) > max) {
        h[meu] = null;
        h[dele] = null;
        // Marca para a tela avisar: a análise foi escrita com esses números
        // errados, então vale refazer.
        h.numerosCorrigidos = true;
        mexeu = true;
      }
    }
    const s = h.snapshot as any;
    if (s?.seuTime?.torresQueDERRUBOU > 11 || s?.timeInimigo?.torresQueDERRUBOU > 11) {
      s.seuTime.torresQueDERRUBOU = null;
      s.timeInimigo.torresQueDERRUBOU = null;
      mexeu = true;
    }
  }
  if (mexeu) console.warn('[lol] limpei números de objetivos impossíveis no histórico.');
  return mexeu;
}

export function listHistory(): HistoryEntry[] {
  return history;
}

/** Salva um retrospecto no topo da lista e devolve o registro criado. */
export async function addHistory(record: Record<string, unknown>): Promise<HistoryEntry> {
  const entry: HistoryEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: new Date().toISOString(),
    ...record,
  };
  history.unshift(entry);
  if (history.length > MAX) history = history.slice(0, MAX);
  await persist();
  return entry;
}

export function getHistory(id: string): HistoryEntry | null {
  return history.find((h) => h.id === id) || null;
}

/** Altera um registro já salvo (marcar vitória/derrota, refazer a análise). */
export async function updateHistory(id: string, patch: Record<string, unknown>): Promise<HistoryEntry | null> {
  const entry = getHistory(id);
  if (!entry) return null;
  Object.assign(entry, patch);
  await persist();
  return entry;
}

export async function deleteHistory(id: string): Promise<boolean> {
  const before = history.length;
  history = history.filter((h) => h.id !== id);
  await persist();
  return before !== history.length;
}
