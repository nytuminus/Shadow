import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@shadow/shared';

// Ordem dos genéricos TROCADA em relação ao servidor de propósito — é assim
// que o Socket.io define os dois lados (eventos que EU ESCUTO vêm primeiro).
export type OfficeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectOfficeSocket(token: string): OfficeSocket {
  return io({
    path: '/socket.io',
    auth: { token },
  });
}
