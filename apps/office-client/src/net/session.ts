import type { EmployeeInfo } from '@shadow/shared';

const KEY = 'shadow.office.session';

export interface Session {
  token: string;
  employee: EmployeeInfo;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* sem localStorage (aba privada etc.) — a sessão só não sobrevive a um reload */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignora */
  }
}
