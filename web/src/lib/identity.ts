// Identidade local do usuário (persistida no navegador). Sem login por ora —
// cada pessoa escolhe nome/cor/avatar e isso viaja junto na sinalização. Dá
// pra plugar autenticação de verdade depois sem mexer no resto.

import type { User } from './types';

const KEY = 'shadow.salas.user';

const CORES = ['#8b7bff', '#3fe6ff', '#ff6ad5', '#67e8a0', '#ffcf5a', '#ff9a6a', '#a78bfa', '#4dd8c0'];

function randomId() {
  return 'u_' + Math.random().toString(36).slice(2, 10);
}

export function loadUser(): User {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const user: User = {
    id: randomId(),
    name: '',
    color: CORES[Math.floor(Math.random() * CORES.length)],
    avatar: '',
  };
  return user;
}

export function saveUser(user: User): User {
  try { localStorage.setItem(KEY, JSON.stringify(user)); } catch { /* ignore */ }
  return user;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const PALETTE = CORES;
