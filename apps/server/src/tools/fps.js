// FPS do jogo — o dado que ninguém entrega de graça.
//
// A Live Client Data API da Riot NÃO expõe FPS (só placar, times e eventos), e
// o Windows não conta quadros de outro processo. A única forma honesta é o
// ETW/PresentMon: o mesmo mecanismo que o CapFrameX e o FrameView usam.
//
// Então: se o PresentMon estiver disponível, o FPS é REAL, medido quadro a
// quadro. Se não estiver, o Shadow diz "n/d" — nunca inventa um número.
//
// Para ligar: baixe o PresentMon (grátis, da Intel) e ponha o .exe em
// ferramentas/PresentMon.exe na pasta do Shadow. Precisa de administrador,
// porque ler quadros de outro processo passa pelo ETW do Windows.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..', '..', '..', '..');

// Onde procurar o PresentMon, do mais fácil de achar para o mais técnico.
// A pasta no APPDATA é a recomendada: sobrevive a uma atualização do app.
const PASTAS = [
  process.env.APPDATA ? join(process.env.APPDATA, 'Shadow', 'ferramentas') : '',
  join(RAIZ, 'ferramentas'),
].filter(Boolean);

const NOMES = ['PresentMon.exe', 'presentmon.exe', 'PresentMon-2.3.0-x64.exe', 'PresentMon-1.10.0-x64.exe'];

const CANDIDATOS = PASTAS.flatMap((pasta) => NOMES.map((n) => join(pasta, n)));

/** Onde o usuário deve colocar o executável. */
export const PASTA_FERRAMENTAS = PASTAS[0];

const PROCESSO_DO_JOGO = 'League of Legends.exe';

let proc = null;
let ultimoFps = null;
let ultimaLeitura = 0;
let indisponivel = false; // já tentamos e não deu: não insiste a cada segundo

export function presentMonPath() {
  return CANDIDATOS.find((p) => existsSync(p)) || null;
}

export const fpsDisponivel = () => !!presentMonPath();

/**
 * FPS atual do jogo.
 * @returns {{fps: number|null, fonte: string, dica?: string}}
 */
export function getFps() {
  const caminho = presentMonPath();
  if (!caminho) {
    return {
      fps: null,
      fonte: 'indisponivel',
      dica:
        'FPS real precisa do PresentMon (grátis, da Intel). Baixe o PresentMon.exe e ' +
        `coloque em ${PASTA_FERRAMENTAS}. Nem a Riot nem o Windows entregam o FPS de outro programa.`,
    };
  }
  if (indisponivel) {
    return { fps: null, fonte: 'erro', dica: 'O PresentMon não conseguiu medir (normalmente falta abrir o Shadow como administrador).' };
  }
  // Leitura velha demais quer dizer que o jogo fechou ou parou de renderizar.
  if (ultimoFps != null && Date.now() - ultimaLeitura > 4000) ultimoFps = null;
  return { fps: ultimoFps, fonte: 'presentmon' };
}

/** Liga a medição enquanto o Modo Jogo estiver aberto. */
export function iniciarFps() {
  if (proc || indisponivel) return;
  const caminho = presentMonPath();
  if (!caminho) return;

  try {
    // -output_stdout: joga o CSV na saída; -stop_existing_session evita conflito
    // com outra sessão ETW aberta; -process_name filtra só o jogo.
    proc = spawn(
      caminho,
      [
        '-process_name', PROCESSO_DO_JOGO,
        '-output_stdout',
        '-stop_existing_session',
        '-no_top',
      ],
      { windowsHide: true }
    );
  } catch {
    indisponivel = true;
    return;
  }

  let colunas = null;
  let resto = '';
  proc.stdout.on('data', (chunk) => {
    resto += chunk.toString('utf8');
    let nl;
    while ((nl = resto.indexOf('\n')) >= 0) {
      const linha = resto.slice(0, nl).trim();
      resto = resto.slice(nl + 1);
      if (!linha) continue;
      const campos = linha.split(',');
      if (!colunas) {
        // A primeira linha é o cabeçalho do CSV.
        if (/Application|ProcessName/i.test(linha)) colunas = campos.map((c) => c.trim());
        continue;
      }
      const i = colunas.findIndex((c) => /^msBetweenPresents$/i.test(c));
      if (i < 0) continue;
      const ms = Number(campos[i]);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      // Média móvel: o FPS instantâneo pula demais para ficar legível na tela.
      const agora = 1000 / ms;
      ultimoFps = ultimoFps == null ? agora : ultimoFps * 0.85 + agora * 0.15;
      ultimaLeitura = Date.now();
    }
  });

  proc.stderr.on('data', (d) => {
    const txt = d.toString();
    if (/access|denied|administrator|privile/i.test(txt)) indisponivel = true;
  });
  proc.on('error', () => { indisponivel = true; proc = null; });
  proc.on('exit', () => { proc = null; });
}

/** Desliga a medição quando o Modo Jogo fecha (não fica processo à toa). */
export function pararFps() {
  if (!proc) return;
  try { proc.kill(); } catch { /* já morreu */ }
  proc = null;
  ultimoFps = null;
}
