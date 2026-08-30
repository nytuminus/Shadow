// Comandos salvos — atalhos que o usuario cria uma vez e dispara por nome.
//
// Cada comando tem um "gatilho" (o nome pelo qual voce pede, ex.: "modo
// trabalho") e uma "acao" (a frase que o Shadow executa, ex.: "abre o Chrome,
// o Spotify e a pasta downloads"). Ao rodar, a acao passa pelo mesmo cerebro
// dos comandos falados, entao pode fazer tudo que o Shadow ja faz.
//
// Persistido em server/data/commands.json, no mesmo padrao dos lembretes.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dataFile, ensureDataDir } from '../data-dir.js';

const FILE = dataFile('commands.json');

let commands = [];

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function persist() {
  await ensureDataDir();
  await writeFile(FILE, JSON.stringify(commands, null, 2), 'utf8');
}

export async function loadCommands() {
  try {
    await ensureDataDir();
    if (existsSync(FILE)) commands = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    commands = [];
  }
  return commands;
}

export function listCommands() {
  return commands;
}

export async function addCommand(trigger, action) {
  const t = String(trigger || '').trim();
  const a = String(action || '').trim();
  if (!t || !a) throw new Error('Preencha o gatilho e a ação do comando.');
  const cmd = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    trigger: t,
    action: a,
    runs: 0,
    createdAt: new Date().toISOString(),
  };
  commands.push(cmd);
  await persist();
  return cmd;
}

export async function updateCommand(id, fields) {
  const cmd = commands.find((c) => c.id === id);
  if (!cmd) return null;
  if (fields.trigger != null) cmd.trigger = String(fields.trigger).trim();
  if (fields.action != null) cmd.action = String(fields.action).trim();
  await persist();
  return cmd;
}

export async function deleteCommand(id) {
  const before = commands.length;
  commands = commands.filter((c) => c.id !== id);
  await persist();
  return before !== commands.length;
}

/** Marca um uso (contador), para o painel mostrar os mais usados. */
export async function markRun(id) {
  const cmd = commands.find((c) => c.id === id);
  if (cmd) {
    cmd.runs = (cmd.runs || 0) + 1;
    cmd.lastRun = new Date().toISOString();
    await persist();
  }
  return cmd;
}

/**
 * Encontra um comando pelo gatilho falado/digitado.
 * Casa por igualdade normalizada ou quando o texto contem o gatilho inteiro.
 */
export function findCommand(spoken) {
  const s = norm(spoken);
  if (!s) return null;
  // 1) igualdade exata do gatilho
  let hit = commands.find((c) => norm(c.trigger) === s);
  if (hit) return hit;
  // 2) o texto falado contem o gatilho (ex.: "executa o modo trabalho")
  hit = commands.find((c) => {
    const t = norm(c.trigger);
    return t.length >= 3 && (s === t || s.includes(t));
  });
  return hit || null;
}
