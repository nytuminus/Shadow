// Voz do Shadow — ponto único de síntese, com dois motores e cache em disco.
//
//   local  → Piper, aqui no PC (tts-local.ts). ~0,3s, offline, de graça.
//   gemini → TTS do Gemini. Mais bonita e expressiva, mas ~3s e gasta cota.
//
// O navegador (Web Speech) só tem vozes antigas do Windows, que soam robóticas —
// ele é a última reserva, e quem decide usá-lo é o front-end, quando os dois
// motores daqui falham. Assim ele nunca fica mudo.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { synthesizeLocal, isLocalAvailable } from './tts-local.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', 'data', 'tts-cache');
const MAX_CACHE_FILES = 120;
const MAX_CHARS = 900;

export interface VoiceOption {
  id: string;
  label: string;
  male: boolean;
}

// Vozes do Gemini oferecidas na interface (as mais adequadas a um assistente).
export const VOICES: VoiceOption[] = [
  { id: 'Charon', label: 'Charon — grave e firme (padrão)', male: true },
  { id: 'Algenib', label: 'Algenib — rouca, áspera', male: true },
  { id: 'Enceladus', label: 'Enceladus — baixa, quase sussurrada', male: true },
  { id: 'Orus', label: 'Orus — firme e direta', male: true },
  { id: 'Alnilam', label: 'Alnilam — séria e decidida', male: true },
  { id: 'Iapetus', label: 'Iapetus — limpa e clara', male: true },
  { id: 'Rasalgethi', label: 'Rasalgethi — culta, explicativa', male: true },
  { id: 'Umbriel', label: 'Umbriel — tranquila', male: true },
  { id: 'Fenrir', label: 'Fenrir — animada, jovem', male: true },
  { id: 'Puck', label: 'Puck — descontraída', male: true },
  { id: 'Kore', label: 'Kore — feminina, firme', male: false },
  { id: 'Sulafat', label: 'Sulafat — feminina, calorosa', male: false },
];

const VALID = new Set(VOICES.map((v) => v.id));

// Direção de atuação: é isto que tira o "robô" da leitura.
const STYLE =
  'Leia a fala abaixo em português do Brasil como um assistente pessoal ' +
  'confiante e discreto: voz natural e conversada, ritmo tranquilo, entonação ' +
  'humana, um leve toque de ironia elegante. Não leia estas instruções.\n\n';

let _ai: GoogleGenAI | null = null;
const getAI = () => (_ai ??= new GoogleGenAI({ apiKey: config.apiKey }));
/** Chamado quando a chave muda em tempo de execução (config.saveApiKey). */
export const resetTtsAI = () => { _ai = null; };

// Quando o plano grátis reclama (429), paramos de tentar por um tempo — assim
// o front-end cai na voz do navegador na hora, sem esperar 5 segundos à toa.
let blockedUntil = 0;
export const isBlocked = () => Date.now() < blockedUntil;

const memCache = new Map<string, Buffer>();

function keyFor(text: string, engine: string, voice: string): string {
  return createHash('sha1').update(`${engine}|${voice}|v2|${text}`).digest('hex');
}

/** Empacota PCM 16-bit cru num WAV que o navegador toca direto. */
function wavFromPcm(pcm: Buffer, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function readCache(key: string): Promise<Buffer | null> {
  if (memCache.has(key)) return memCache.get(key)!;
  try {
    const buf = await readFile(join(CACHE_DIR, `${key}.wav`));
    memCache.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

async function writeCache(key: string, buf: Buffer): Promise<void> {
  memCache.set(key, buf);
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `${key}.wav`), buf);
    await pruneCache();
  } catch {
    /* cache é luxo, não obrigação */
  }
}

// Mantém a pasta de cache enxuta, descartando os arquivos mais antigos.
async function pruneCache(): Promise<void> {
  const files = await readdir(CACHE_DIR).catch(() => [] as string[]);
  if (files.length <= MAX_CACHE_FILES) return;
  const info = await Promise.all(
    files.map(async (f) => {
      const p = join(CACHE_DIR, f);
      const s = await stat(p).catch(() => null);
      return { p, t: s?.mtimeMs || 0 };
    })
  );
  info.sort((a, b) => a.t - b.t);
  for (const f of info.slice(0, info.length - MAX_CACHE_FILES)) {
    await unlink(f.p).catch(() => {});
  }
}

export interface SynthesizeOptions {
  engine?: 'local' | 'gemini';
  voice?: string;
}

interface QuotaError extends Error {
  quota: true;
}

/** Gera (ou recupera do cache) o áudio de uma fala. Devolve um WAV pronto pra tocar. */
export async function synthesize(text: string, opts: SynthesizeOptions = {}): Promise<Buffer> {
  const engine = opts.engine === 'gemini' ? 'gemini' : 'local';
  const voice = opts.voice && VALID.has(opts.voice) ? opts.voice : config.ttsVoice;
  // NFC: "é" digitado de duas formas diferentes vira a mesma chave de cache.
  const clean = String(text || '').normalize('NFC').trim().slice(0, MAX_CHARS);
  if (!clean) throw new Error('Texto vazio.');

  const key = keyFor(clean, engine, engine === 'local' ? config.localVoice : voice);
  const cached = await readCache(key);
  if (cached) return cached;

  if (engine === 'local') {
    const wav = await synthesizeLocal(clean);
    await writeCache(key, wav);
    return wav;
  }

  if (isBlocked()) {
    const err = new Error('TTS em espera de cota.') as QuotaError;
    err.quota = true;
    throw err;
  }

  try {
    const res: any = await getAI().models.generateContent({
      model: config.ttsModel,
      contents: [{ parts: [{ text: STYLE + clean }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    } as any);

    const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!part) throw new Error('O modelo não devolveu áudio.');

    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
    const wav = wavFromPcm(Buffer.from(part.inlineData.data, 'base64'), rate);
    await writeCache(key, wav);
    return wav;
  } catch (err) {
    const msg = String((err as any)?.message || err);
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      blockedUntil = Date.now() + 90_000; // dá um tempo antes de tentar de novo
      const quotaErr = new Error('Cota de voz esgotada.') as QuotaError;
      quotaErr.quota = true;
      throw quotaErr;
    }
    throw err;
  }
}

/**
 * Deixa uma fala pronta no cache, sem bloquear o boot.
 * Usado com o bordão, para ele sair instantaneamente.
 */
export function warmUp(text: string, opts?: SynthesizeOptions): void {
  setTimeout(() => {
    synthesize(text, opts).catch(() => {});
  }, 1500);
}

export { isLocalAvailable };
