import type { EmployeeInfo, LoginResult } from '@shadow/shared';

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await fetch('/api/office/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Falha no login.');
  return data;
}

export async function me(token: string): Promise<{ employee: EmployeeInfo }> {
  const res = await fetch('/api/office/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Sessão expirada.');
  return res.json();
}

/** Reaproveita o mesmo endpoint que as Salas antigas usavam (STUN + TURN do .env). */
export async function getRtcConfig(): Promise<{ iceServers: RTCIceServer[] }> {
  const res = await fetch('/api/community/rtc-config');
  if (!res.ok) throw new Error('Falha ao buscar configuração de rede.');
  return res.json();
}
