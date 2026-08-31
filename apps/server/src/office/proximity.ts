// Detecção de proximidade — o coração do "liga sozinho" do escritório 2D.
//
// Roda a cada tick (mesmo intervalo do broadcast de posição em socket.ts):
// compara todo mundo no MESMO mapa e decide quem entrou/saiu do raio de
// chamada. Histerese de propósito (EXIT_RADIUS > ENTER_RADIUS): sem isso,
// dois avatares parados bem na borda do raio ficariam ligando/desligando a
// chamada em loop a cada tick.
//
// O(n²) por tick — ok pra dezenas de pessoas (escala de uma empresa). Se um
// dia isso precisar aguentar centenas no mesmo mapa, a saída é um grid
// espacial (bucket por região do mapa) em vez de comparar todo mundo com
// todo mundo; não é problema agora.

import type { PlayerState } from '@shadow/shared';

const ENTER_RADIUS = 96;
const EXIT_RADIUS = 140;

interface Pair {
  a: string;
  b: string;
}

export interface ProximityChange {
  a: string;
  b: string;
  type: 'enter' | 'leave';
}

// chave "menorId|maiorId" -> par conectado agora
const connected = new Map<string, Pair>();

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const distance = (a: PlayerState, b: PlayerState): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Roda a cada tick com todo mundo conectado; devolve só quem MUDOU agora. */
export function updateProximity(players: PlayerState[]): ProximityChange[] {
  const changes: ProximityChange[] = [];
  const byMap = new Map<string, PlayerState[]>();
  for (const p of players) {
    if (!byMap.has(p.mapId)) byMap.set(p.mapId, []);
    byMap.get(p.mapId)!.push(p);
  }

  const seenPairs = new Set<string>();

  for (const group of byMap.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const key = pairKey(a.socketId, b.socketId);
        seenPairs.add(key);
        const dist = distance(a, b);
        const isConnected = connected.has(key);
        if (!isConnected && dist <= ENTER_RADIUS) {
          connected.set(key, { a: a.socketId, b: b.socketId });
          changes.push({ a: a.socketId, b: b.socketId, type: 'enter' });
        } else if (isConnected && dist > EXIT_RADIUS) {
          connected.delete(key);
          changes.push({ a: a.socketId, b: b.socketId, type: 'leave' });
        }
      }
    }
  }

  // Pares que sumiram do tick (desconectou, trocou de mapa) também se despedem.
  for (const [key, pair] of connected) {
    if (!seenPairs.has(key)) {
      connected.delete(key);
      changes.push({ a: pair.a, b: pair.b, type: 'leave' });
    }
  }

  return changes;
}

/** Chamado quando alguém desconecta — encerra qualquer proximidade pendente dela. */
export function removePlayer(socketId: string): ProximityChange[] {
  const changes: ProximityChange[] = [];
  for (const [key, pair] of connected) {
    if (pair.a === socketId || pair.b === socketId) {
      connected.delete(key);
      changes.push({ a: pair.a, b: pair.b, type: 'leave' });
    }
  }
  return changes;
}
