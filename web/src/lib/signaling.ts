// Cliente WebSocket de sinalização. Fala com server/realtime/signaling.js.
// Reconecta sozinho e reemite 'hello' + rejoin do canal de voz ativo.

import type { User } from './types';

type Handler = (msg: any) => void;

export class Signaling {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private user: User | null = null;
  private url: string;
  private reconnectTimer: any = null;
  private closedByUser = false;
  selfId: string | null = null;
  /** Estado para reingressar no canal de voz após reconexão. */
  rejoin: { channelId: string; state: any } | null = null;

  constructor() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${proto}://${location.host}/ws`;
  }

  connect(user: User) {
    this.user = user;
    this.closedByUser = false;
    this.open();
  }

  private open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.send({ type: 'hello', user: this.user });
      if (this.rejoin) this.send({ type: 'join-voice', ...this.rejoin });
      this.emit('open', {});
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'welcome') this.selfId = msg.selfId;
      this.emit(msg.type, msg);
    };

    ws.onclose = () => {
      this.emit('close', {});
      if (!this.closedByUser) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.open(), 1500);
      }
    };

    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  }

  updateUser(user: User) {
    this.user = user;
    this.send({ type: 'hello', user });
  }

  send(obj: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  on(type: string, handler: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, msg: any) {
    this.handlers.get(type)?.forEach((h) => h(msg));
  }

  disconnect() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    try { this.ws?.close(); } catch { /* */ }
  }
}
