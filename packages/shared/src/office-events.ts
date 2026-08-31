// Contrato dos eventos do Socket.io entre o cliente do escritório e o
// servidor. Os dois lados importam ISTO em vez de reescrever os tipos —
// mudou um evento aqui, os dois lados quebram a compilação juntos.
//
// CUIDADO: o Socket.io usa ORDEM DE GENÉRICOS DIFERENTE nos dois lados.
//   Servidor: new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer)
//   Cliente:  io<ServerToClientEvents, ClientToServerEvents>(url, opts)   -- só 2, e na ordem trocada
// Inverter por engano não dá erro de compilação — só vira `any` num dos
// lados silenciosamente. Conferir sempre contra este comentário.

import type { Direction, PlayerState } from './player.js';

export interface MovePayload {
  x: number;
  y: number;
  direction: Direction;
  moving: boolean;
}

export interface ProximityPayload {
  peerId: string; // socketId do outro jogador
}

// Repasse cru de sinalização WebRTC (offer/answer/ICE) — o servidor NÃO olha
// pra dentro de `data`, só entrega pro peer certo. Mesmo papel do antigo
// `case 'signal'` do /ws das Salas, agora ponto-a-ponto por proximidade.
export interface WebrtcSignalOut {
  to: string; // socketId do destinatário
  data: unknown;
}
export interface WebrtcSignalIn {
  from: string; // socketId de quem mandou
  data: unknown;
}

// Chat de texto global do escritório (todo mundo no mapa vê). Persistido
// pela mesma camada de banco das Salas (mapId faz o papel de channelId).
export interface ChatMessage {
  id: string;
  employeeId: string | null;
  name: string;
  text: string;
  createdAt: string;
}

export interface ClientToServerEvents {
  'player:move': (payload: MovePayload) => void;
  'webrtc:signal': (payload: WebrtcSignalOut) => void;
  'chat:send': (payload: { text: string }) => void;
}

export interface ServerToClientEvents {
  'players:snapshot': (players: PlayerState[]) => void;
  'player:left': (payload: { socketId: string }) => void;
  'proximity:enter': (payload: ProximityPayload) => void;
  'proximity:leave': (payload: ProximityPayload) => void;
  'webrtc:signal': (payload: WebrtcSignalIn) => void;
  'chat:history': (messages: ChatMessage[]) => void;
  'chat:message': (message: ChatMessage) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface InterServerEvents {}

export interface SocketData {
  employeeId: string;
  username: string;
  name: string;
  mapId: string;
}
