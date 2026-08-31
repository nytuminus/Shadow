import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Onde procurar o .env, em ordem:
//   1. a pasta do projeto (uso normal, pelo Shadow.bat ou npm start);
//   2. %APPDATA%\Shadow\.env — usado quando o Shadow está INSTALADO como
//      aplicativo: assim a chave da API sobrevive a uma atualização do app;
//   3. o .env da pasta de onde o processo foi chamado (compatibilidade).
const CANDIDATOS: string[] = [
  join(__dirname, '..', '..', '..', '.env'),
  process.env.APPDATA ? join(process.env.APPDATA, 'Shadow', '.env') : '',
  join(process.cwd(), '.env'),
].filter(Boolean);

for (const caminho of CANDIDATOS) {
  if (existsSync(caminho)) loadEnv({ path: caminho });
}

// Rodando dentro do aplicativo instalado? Aí o .env de verdade é o do APPDATA:
// a pasta do programa pode ser substituída numa atualização.
export const isPackagedApp = !!process.versions.electron;

/** Onde o usuário deve colocar a chave da API. */
export const ENV_PATH: string =
  CANDIDATOS.find((c) => existsSync(c)) ||
  (isPackagedApp && CANDIDATOS[1] ? CANDIDATOS[1] : CANDIDATOS[0]!);

export interface ShadowConfig {
  apiKey: string;
  model: string;
  fallbackModel: string;
  port: number;
  userName: string;
  assistantName: string;
  ttsVoice: string;
  ttsModel: string;
  ttsEnabled: boolean;
  localVoice: string;
  localRate: number;
  defaultEngine: string;
  spotifyClientId: string;
  spotifyClientSecret: string;
}

export const config: ShadowConfig = {
  // Aceita GEMINI_API_KEY (nome novo) ou GOOGLE_API_KEY (alternativo).
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  model: process.env.JARVIS_MODEL || 'gemini-flash-latest',
  // Reserva para quando o principal esgota a cota do DIA: no plano grátis cada
  // modelo tem sua própria cota, então o Shadow continua vivo com este aqui.
  fallbackModel: process.env.SHADOW_FALLBACK_MODEL || 'gemini-flash-lite-latest',
  port: Number(process.env.PORT) || 4577,
  userName: process.env.JARVIS_USER_NAME || 'Senhor',
  // Nome do assistente (e palavra de ativação).
  assistantName: process.env.ASSISTANT_NAME || 'Shadow',
  // Voz neural do Gemini (mais bonita, ~3s, gasta cota). Lista em tts.ts.
  ttsVoice: process.env.SHADOW_VOICE || 'Charon',
  ttsModel: process.env.SHADOW_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
  ttsEnabled: process.env.SHADOW_TTS !== 'off',
  // Voz local do Piper (rápida, offline, de graça). É o motor padrão.
  localVoice: process.env.SHADOW_LOCAL_VOICE || 'pt_BR-faber-medium',
  // Velocidade da voz local: menor = mais rápida (1.0 é o natural).
  localRate: Number(process.env.SHADOW_LOCAL_RATE) || 0.98,
  defaultEngine: process.env.SHADOW_ENGINE || 'local',
  // Spotify (opcional): controla a reprodução via API oficial. Precisa Premium.
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
};

// URI de redirecionamento do login do Spotify (deve bater com o painel de dev).
export const spotifyRedirectUri =
  process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${config.port}/api/spotify/callback`;

export const hasSpotify = (): boolean =>
  !!config.spotifyClientId && !!config.spotifyClientSecret;

// Bordão: resposta fixa sempre que perguntam se ele está aí.
export const CATCHPHRASE = process.env.SHADOW_CATCHPHRASE || 'O que é, desgraça?';

export const hasApiKey = (): boolean =>
  typeof config.apiKey === 'string' && config.apiKey.trim().length > 20;

/**
 * Grava a chave da API no .env e passa a valer NA HORA (sem reiniciar).
 * Quem chama precisa zerar os clientes já criados — veja resetAIClients().
 */
export async function saveApiKey(chave: string): Promise<string> {
  const limpa = String(chave || '').trim();
  if (limpa.length < 20 || /\s/.test(limpa)) {
    throw new Error('Essa chave não parece válida. Ela é uma linha só, sem espaços.');
  }

  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  let texto = '';
  if (existsSync(ENV_PATH)) texto = await readFile(ENV_PATH, 'utf8');
  else await mkdir(dirname(ENV_PATH), { recursive: true });

  const linha = `GEMINI_API_KEY=${limpa}`;
  texto = /^GEMINI_API_KEY=.*$/m.test(texto)
    ? texto.replace(/^GEMINI_API_KEY=.*$/m, linha)
    : (texto.trim() ? texto.replace(/\s*$/, '\n') : '') + linha + '\n';

  await writeFile(ENV_PATH, texto, 'utf8');
  config.apiKey = limpa;
  process.env.GEMINI_API_KEY = limpa;
  return ENV_PATH;
}
