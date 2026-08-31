// Servidor de sinalização em tempo real da área "Salas" (estilo Discord).
//
// Faz três coisas por WebSocket, no caminho /ws:
//   1. Presença de voz: quem está em cada canal de voz/vídeo (mesh WebRTC);
//   2. Repasse de sinalização WebRTC (offer/answer/ICE) entre os participantes
//      de um mesmo canal de voz — o servidor NÃO toca no áudio/vídeo, só
//      apresenta os pares; a mídia vai direto peer-to-peer;
//   3. Chat de texto por canal (persistido no banco e transmitido ao vivo).
//
// Escala esperada: uma empresa (dezenas de pessoas). Mesh WebRTC é adequado
// para grupos pequenos por chamada; se um dia precisar de salas grandes,
// troca-se por uma SFU sem mexer no protocolo do cliente.

import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { addGatherInboxItem } from '../tools/gather-inbox.js';

/** @typedef {{ id:string, ws:import('ws').WebSocket, user:object, channelId:string|null, state:object }} Peer */

/** @type {Map<string, Peer>} */
const peers = new Map(); // peerId -> peer
/** @type {Map<string, Set<string>>} */
const voice = new Map(); // channelId -> Set<peerId>

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch { /* conexão caiu */ }
  }
}

function broadcastAll(obj, exceptId) {
  for (const [id, p] of peers) {
    if (id !== exceptId) send(p.ws, obj);
  }
}

function channelPeers(channelId) {
  const set = voice.get(channelId);
  if (!set) return [];
  return [...set]
    .map((id) => peers.get(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, user: p.user, state: p.state }));
}

// Snapshot de presença de TODOS os canais de voz — o cliente usa para pintar
// os pontinhos de "quem está na chamada" ao lado de cada canal.
function presenceSnapshot() {
  const out = {};
  for (const [channelId, set] of voice) {
    if (set.size) out[channelId] = channelPeers(channelId);
  }
  return out;
}

function leaveVoice(peer, notify = true) {
  const channelId = peer.channelId;
  if (!channelId) return;
  const set = voice.get(channelId);
  if (set) {
    set.delete(peer.id);
    if (set.size === 0) voice.delete(channelId);
  }
  peer.channelId = null;
  peer.state = {};
  if (notify) {
    broadcastAll({ type: 'peer-left', channelId, peerId: peer.id });
    broadcastAll({ type: 'presence', presence: presenceSnapshot() });
  }
}

export function attachSignaling(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const peer = { id: nanoid(12), ws, user: { id: null, name: 'Convidado' }, channelId: null, state: {} };
    peers.set(peer.id, peer);
    send(ws, { type: 'welcome', selfId: peer.id, presence: presenceSnapshot() });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        // Identificação do usuário.
        case 'hello': {
          const u = msg.user || {};
          peer.user = {
            id: u.id || peer.id,
            name: String(u.name || 'Convidado').slice(0, 40),
            avatar: u.avatar || '',
            color: u.color || '',
          };
          try { await db().upsertUser(peer.user); } catch { /* opcional */ }
          break;
        }

        // Entrar num canal de voz/vídeo.
        case 'join-voice': {
          const channelId = String(msg.channelId || '');
          if (!channelId) return;
          if (peer.channelId && peer.channelId !== channelId) leaveVoice(peer);
          peer.channelId = channelId;
          peer.state = msg.state || { muted: false, video: false, screen: false };
          if (!voice.has(channelId)) voice.set(channelId, new Set());
          // Os pares que JÁ estavam no canal — o novato liga pra cada um deles.
          const existing = channelPeers(channelId);
          voice.get(channelId).add(peer.id);
          send(ws, { type: 'voice-peers', channelId, peers: existing });
          // Avisa os demais que alguém entrou (eles aguardam a oferta do novato).
          broadcastAll({ type: 'peer-joined', channelId, peer: { id: peer.id, user: peer.user, state: peer.state } }, peer.id);
          broadcastAll({ type: 'presence', presence: presenceSnapshot() });
          break;
        }

        case 'leave-voice': {
          leaveVoice(peer);
          break;
        }

        // Repasse de sinalização WebRTC para um par específico do mesmo canal.
        case 'signal': {
          const dest = peers.get(msg.to);
          if (dest) send(dest.ws, { type: 'signal', from: peer.id, data: msg.data });
          break;
        }

        // Atualização de estado (mic mudo, câmera, tela) — reflete nos tiles.
        case 'state': {
          peer.state = { ...peer.state, ...(msg.state || {}) };
          if (peer.channelId) {
            broadcastAll({ type: 'peer-state', channelId: peer.channelId, peerId: peer.id, state: peer.state });
            broadcastAll({ type: 'presence', presence: presenceSnapshot() });
          }
          break;
        }

        // Chat de texto: persiste e transmite pra todo mundo.
        case 'chat': {
          const channelId = String(msg.channelId || '');
          const text = String(msg.text || '').trim().slice(0, 2000);
          if (!channelId || !text) return;
          let saved;
          try {
            saved = await db().addMessage(channelId, { userId: peer.user.id, userName: peer.user.name, text });
          } catch (err) {
            send(ws, { type: 'error', error: 'Falha ao salvar a mensagem.' });
            return;
          }
          broadcastAll({ type: 'chat', message: saved });
          // Notificação "melhor esforço": não atrasa nem derruba o chat se falhar.
          db().getChannel(channelId).then((channel) => {
            addGatherInboxItem({
              id: saved.id,
              text: `#${channel?.name || channelId} · ${peer.user.name}: ${text}`,
            });
          }).catch(() => {});
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      leaveVoice(peer);
      peers.delete(peer.id);
    });
    ws.on('error', () => { /* ignora; o close cuida da limpeza */ });
  });

  // Ping periódico pra derrubar conexões zumbis.
  const interval = setInterval(() => {
    for (const p of peers.values()) {
      if (p.ws.readyState === p.ws.OPEN) { try { p.ws.ping(); } catch { /* */ } }
    }
  }, 25000);
  wss.on('close', () => clearInterval(interval));

  return wss;
}
