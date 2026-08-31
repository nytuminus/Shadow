// Integração com o Spotify (API oficial Web API).
//
// Fluxo: Authorization Code. O usuário faz login uma vez; guardamos o
// refresh_token em disco e renovamos o access_token sozinhos. Controlar a
// reprodução (play/pause/próxima/volume) exige conta PREMIUM — é regra da Spotify.
//
// Configuração no .env: SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET (pegos no
// painel de desenvolvedor). A Redirect URI precisa ser exatamente a de config.ts.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { config, hasSpotify, spotifyRedirectUri } from '../config.js';
import { dataFile, ensureDataDir } from '../data-dir.js';

const FILE = dataFile('spotify.json');

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

let refreshToken: string | null = null;
let access: { token: string | null; expiresAt: number } = { token: null, expiresAt: 0 };

const basicAuth = () =>
  'Basic ' + Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');

async function persist(): Promise<void> {
  await ensureDataDir();
  await writeFile(FILE, JSON.stringify({ refreshToken }, null, 2), 'utf8');
}

export async function loadSpotify(): Promise<void> {
  try {
    await ensureDataDir();
    if (existsSync(FILE)) refreshToken = JSON.parse(await readFile(FILE, 'utf8')).refreshToken || null;
  } catch {
    refreshToken = null;
  }
}

export const isConnected = (): boolean => !!refreshToken;

// ---- OAuth ----
export function getAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.spotifyClientId,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri,
    scope: SCOPES,
    state,
  });
  return 'https://accounts.spotify.com/authorize?' + p.toString();
}

export async function exchangeCode(code: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: spotifyRedirectUri,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('Falha na troca do código do Spotify.');
  const data: any = await res.json();
  refreshToken = data.refresh_token || refreshToken;
  access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  await persist();
}

async function getAccessToken(): Promise<string> {
  if (access.token && Date.now() < access.expiresAt) return access.token;
  if (!refreshToken) throw new Error('Spotify não conectado.');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('Falha ao renovar o acesso ao Spotify.');
  const data: any = await res.json();
  access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return access.token!;
}

interface SpotifyError extends Error {
  status?: number;
}

// ---- Chamada genérica à Web API ----
async function api(method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}) {
  const { query, body } = opts;
  const token = await getAccessToken();
  const url = 'https://api.spotify.com/v1' + path + (query ? '?' + new URLSearchParams(query as Record<string, string>) : '');
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null; // sem conteúdo (comandos de playback)
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error?.message || `Erro ${res.status}`;
    const err: SpotifyError = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- Dispositivo ativo ----
// Playback precisa de um dispositivo. Se nenhum estiver ativo mas houver um
// disponível (Spotify aberto no PC/celular), transferimos para ele.
async function ensureDevice(): Promise<string> {
  const data = await api('GET', '/me/player/devices');
  const devices = data?.devices || [];
  if (!devices.length) {
    throw new Error('Nenhum dispositivo do Spotify encontrado. Abra o Spotify no computador ou no celular.');
  }
  const active = devices.find((d: any) => d.is_active);
  if (active) return active.id;
  const target = devices[0];
  await api('PUT', '/me/player', { body: { device_ids: [target.id], play: false } });
  return target.id;
}

// ---- Ações ----
export async function play(query: string): Promise<string> {
  const deviceId = await ensureDevice();
  if (query && query.trim()) {
    const found = await searchTrack(query);
    if (!found) throw new Error(`Não achei "${query}" no Spotify.`);
    await api('PUT', '/me/player/play', { query: { device_id: deviceId }, body: { uris: [found.uri] } });
    return `Tocando ${found.name}, de ${found.artist}.`;
  }
  await api('PUT', '/me/player/play', { query: { device_id: deviceId } });
  return 'Reproduzindo.';
}

export async function pause(): Promise<string> {
  await api('PUT', '/me/player/pause');
  return 'Pausado.';
}
export async function next(): Promise<string> {
  await api('POST', '/me/player/next');
  return 'Próxima música.';
}
export async function previous(): Promise<string> {
  await api('POST', '/me/player/previous');
  return 'Música anterior.';
}
export async function setVolume(percent: number): Promise<string> {
  const v = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  await api('PUT', '/me/player/volume', { query: { volume_percent: v } });
  return `Volume em ${v}%.`;
}

export async function searchTrack(query: string): Promise<{ uri: string; name: string; artist: string } | null> {
  const data = await api('GET', '/search', { query: { q: query, type: 'track', limit: 1 } });
  const item = data?.tracks?.items?.[0];
  if (!item) return null;
  return { uri: item.uri, name: item.name, artist: item.artists?.map((a: any) => a.name).join(', ') };
}

export async function current() {
  const data = await api('GET', '/me/player');
  if (!data || !data.item) return { isPlaying: false, track: null };
  return {
    isPlaying: !!data.is_playing,
    track: data.item.name,
    artist: data.item.artists?.map((a: any) => a.name).join(', '),
    album: data.item.album?.name,
    imageUrl: data.item.album?.images?.[0]?.url || null,
    progressMs: data.progress_ms,
    durationMs: data.item.duration_ms,
    volume: data.device?.volume_percent ?? null,
    device: data.device?.name || null,
  };
}

export async function status() {
  const st: { configured: boolean; connected: boolean; premiumHint: boolean; current?: unknown; error?: string } = {
    configured: hasSpotify(),
    connected: isConnected(),
    premiumHint: true,
  };
  if (st.connected) {
    try { st.current = await current(); }
    catch (e) { st.error = e instanceof Error ? e.message : String(e); }
  }
  return st;
}

/** Resumo curto para o Shadow falar. */
export async function currentSummary(): Promise<string> {
  if (!isConnected()) return 'O Spotify ainda não está conectado.';
  try {
    const c = await current();
    if (!c.track) return 'Nada tocando no Spotify agora.';
    return `${c.isPlaying ? 'Tocando' : 'Pausado'}: ${c.track}, de ${c.artist}.`;
  } catch {
    return 'Não consegui ler o Spotify agora.';
  }
}
