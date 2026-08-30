// Chamadas REST à API de comunidade do motor Shadow.

import type { Room, ChatMessage } from './types';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
  return res.json();
}

export const api = {
  rooms: () => fetch('/api/community/rooms').then((r) => j<Room[]>(r)),

  createRoom: (data: { name: string; icon?: string; color?: string }) =>
    fetch('/api/community/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => j<Room>(r)),

  deleteRoom: (id: string) =>
    fetch(`/api/community/rooms/${id}`, { method: 'DELETE' }).then((r) => j(r)),

  createChannel: (roomId: string, data: { name: string; type: 'text' | 'voice' }) =>
    fetch(`/api/community/rooms/${roomId}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => j(r)),

  deleteChannel: (id: string) =>
    fetch(`/api/community/channels/${id}`, { method: 'DELETE' }).then((r) => j(r)),

  messages: (channelId: string, limit = 50) =>
    fetch(`/api/community/channels/${channelId}/messages?limit=${limit}`).then((r) => j<ChatMessage[]>(r)),

  rtcConfig: () => fetch('/api/community/rtc-config').then((r) => j<{ iceServers: RTCIceServer[] }>(r)),
};
