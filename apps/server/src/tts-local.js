// Voz LOCAL do Shadow — Piper (neural, roda no seu PC, sem internet).
//
// Por que existe: a voz do Gemini soa melhor, mas leva ~3 s para chegar e gasta
// cota. O Piper gera a mesma frase em ~0,3 s, de graça e offline. Ele é o padrão;
// o Gemini fica como opção de "máxima qualidade".
//
// Truque de desempenho: o processo do Piper fica VIVO entre os pedidos. Carregar
// o modelo custa ~0,4 s — pagando isso uma vez só, cada frase sai em ~0,2 s.
// O Piper lê uma frase por linha no stdin e imprime no stdout o caminho do WAV
// que gerou, na mesma ordem — é isso que casa pedido e resposta aqui.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', 'voz-local');
const EXE = join(ROOT, 'piper', 'piper.exe');
const MODEL = join(ROOT, `${config.localVoice}.onnx`);
// Fora da pasta do projeto de propósito: evita o OneDrive sincronizar áudio temporário.
const OUT_DIR = join(tmpdir(), 'shadow-piper');

const TIMEOUT_MS = 20_000;

export const isLocalAvailable = () => existsSync(EXE) && existsSync(MODEL);

let proc = null;
let starting = null;
const queue = []; // pedidos aguardando, na ordem em que foram enviados

async function ensureProcess() {
  if (proc) return proc;
  if (starting) return starting;

  starting = (async () => {
    await mkdir(OUT_DIR, { recursive: true });
    const p = spawn(
      EXE,
      [
        '--model', MODEL,
        '--output_dir', OUT_DIR,
        '--length_scale', String(config.localRate),
        '--sentence_silence', '0.25',
      ],
      { cwd: join(ROOT, 'piper'), stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let buf = '';
    p.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) deliver(line);
      }
    });

    // O Piper loga no stderr; só interessa se ele morrer.
    p.stderr.on('data', () => {});

    const die = (motivo) => {
      if (proc === p) proc = null;
      while (queue.length) queue.shift().reject(new Error(motivo));
    };
    p.on('exit', (code) => die(`Piper encerrou (código ${code}).`));
    p.on('error', (err) => die(`Piper falhou: ${err.message}`));

    proc = p;
    starting = null;
    return p;
  })();

  return starting;
}

async function deliver(wavPath) {
  const pedido = queue.shift();
  if (!pedido) return;
  try {
    const data = await readFile(wavPath);
    pedido.resolve(data);
  } catch (err) {
    pedido.reject(err);
  } finally {
    unlink(wavPath).catch(() => {});
  }
}

/**
 * Gera a fala localmente.
 * @returns {Promise<Buffer>} WAV pronto para tocar
 */
export async function synthesizeLocal(text) {
  if (!isLocalAvailable()) throw new Error('Voz local não instalada.');

  // Uma frase por linha: quebras de linha viram espaço para não virar dois pedidos.
  const linha = String(text).replace(/[\r\n]+/g, ' ').trim();
  if (!linha) throw new Error('Texto vazio.');

  const p = await ensureProcess();

  return new Promise((resolve, reject) => {
    const pedido = {
      resolve: (v) => { clearTimeout(pedido.timer); resolve(v); },
      reject: (e) => { clearTimeout(pedido.timer); reject(e); },
    };
    pedido.timer = setTimeout(() => {
      const i = queue.indexOf(pedido);
      if (i >= 0) queue.splice(i, 1);
      reject(new Error('Piper demorou demais.'));
    }, TIMEOUT_MS);

    queue.push(pedido);
    p.stdin.write(linha + '\n', 'utf8', (err) => {
      if (err) {
        const i = queue.indexOf(pedido);
        if (i >= 0) queue.splice(i, 1);
        pedido.reject(err);
      }
    });
  });
}

/** Deixa o modelo carregado já no boot, para a primeira fala não pagar o pedágio. */
export function warmUpLocal() {
  if (!isLocalAvailable()) return;
  ensureProcess().catch(() => {});
}

export async function shutdownLocal() {
  if (proc) {
    try { proc.stdin.end(); } catch { /* noop */ }
    try { proc.kill(); } catch { /* noop */ }
    proc = null;
  }
  await rm(OUT_DIR, { recursive: true, force: true }).catch(() => {});
}
