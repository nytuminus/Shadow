import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dataFile, ensureDataDir } from '../data-dir.js';

const FILE = dataFile('reminders.json');

export interface Reminder {
  id: string;
  message: string;
  time: string;
  done: boolean;
  createdAt: string;
}

/** Emite "reminder" quando um lembrete vence, para o servidor avisar a interface. */
export const reminderEvents = new EventEmitter();

let reminders: Reminder[] = [];

async function persist(): Promise<void> {
  await ensureDataDir();
  await writeFile(FILE, JSON.stringify(reminders, null, 2), 'utf8');
}

export async function loadReminders(): Promise<Reminder[]> {
  try {
    await ensureDataDir();
    if (existsSync(FILE)) {
      reminders = JSON.parse(await readFile(FILE, 'utf8'));
    }
  } catch {
    reminders = [];
  }
  return reminders;
}

/**
 * Interpreta expressões de tempo em português para um horário absoluto (ISO).
 * Aceita:
 *   - "em 10 minutos", "em 2 horas", "em 30 segundos"
 *   - "às 15:30", "as 9h", "amanhã às 8"
 * Se nada casar, tenta Date.parse; por fim, lança erro.
 */
export function parseWhen(when: string): string {
  const text = String(when || '').trim().toLowerCase();
  const now = new Date();

  // "em X minutos/horas/segundos"
  const rel = text.match(/em\s+(\d+)\s*(segundo|minuto|hora|dia)s?/);
  if (rel) {
    const amount = Number(rel[1]);
    const unitMs = ({ segundo: 1000, minuto: 60000, hora: 3600000, dia: 86400000 } as Record<string, number>)[rel[2]!];
    return new Date(now.getTime() + amount * unitMs!).toISOString();
  }

  // "amanhã ..." adiciona 1 dia à base
  const base = new Date(now);
  const tomorrow = /amanh[aã]/.test(text);
  if (tomorrow) base.setDate(base.getDate() + 1);

  // "às 15:30" / "as 9h" / "às 9"
  const abs = text.match(/[àa]s?\s+(\d{1,2})(?:[:h](\d{2}))?/);
  if (abs) {
    const h = Number(abs[1]);
    const m = abs[2] ? Number(abs[2]) : 0;
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    if (!tomorrow && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  const parsed = Date.parse(when);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();

  throw new Error('Não entendi o horário. Tente algo como "em 10 minutos" ou "às 15:30".');
}

export async function createReminder(message: string, when: string) {
  const iso = parseWhen(when);
  const reminder: Reminder = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    message: String(message || 'Lembrete'),
    time: iso,
    done: false,
    createdAt: new Date().toISOString(),
  };
  reminders.push(reminder);
  await persist();
  const quando = new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return { reminder, human: `Lembrete criado para ${quando}: "${reminder.message}".` };
}

export function listReminders(): Reminder[] {
  return reminders
    .filter((r) => !r.done)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

export async function deleteReminder(id: string): Promise<boolean> {
  const before = reminders.length;
  reminders = reminders.filter((r) => r.id !== id);
  await persist();
  return before !== reminders.length;
}

/** Verifica lembretes vencidos a cada 15s e dispara o evento. */
export function startReminderLoop(): void {
  setInterval(async () => {
    const now = Date.now();
    let changed = false;
    for (const r of reminders) {
      if (!r.done && new Date(r.time).getTime() <= now) {
        r.done = true;
        changed = true;
        reminderEvents.emit('reminder', r);
      }
    }
    if (changed) await persist();
  }, 15000);
}
