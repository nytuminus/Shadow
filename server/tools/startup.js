// "Iniciar com o Windows" — cria (ou remove) um atalho do Shadow na pasta
// Inicializar do usuário.
//
// Por que atalho e não registro: a pasta Inicializar é visível, o próprio
// usuário consegue conferir e apagar, e não exige permissão de administrador.
//
// Quando o Shadow roda como aplicativo (Electron), quem manda no atalho é o
// próprio Electron (app.setLoginItemSettings) — veja desktop/main.js. Aqui é o
// caminho para quem usa a versão do navegador, pelo Shadow.bat.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const BAT = join(ROOT_DIR, 'Shadow.bat');

const STARTUP_DIR = process.env.APPDATA
  ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  : '';
const LINK = STARTUP_DIR ? join(STARTUP_DIR, 'Shadow.lnk') : '';

const suportado = () => process.platform === 'win32' && !!STARTUP_DIR && existsSync(BAT);

/** Roda um trecho de PowerShell e espera o fim. */
function powershell(script) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );
    let erro = '';
    p.stderr.on('data', (c) => (erro += c.toString()));
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(erro.trim() || `PowerShell saiu com código ${code}`))
    );
  });
}

export async function startupStatus() {
  return {
    supported: suportado(),
    enabled: !!LINK && existsSync(LINK),
    path: LINK || null,
  };
}

/**
 * Liga ou desliga a inicialização automática.
 * @param {boolean} enabled
 */
export async function setStartup(enabled) {
  if (!suportado()) {
    throw new Error('Inicialização automática só funciona no Windows, com o Shadow.bat na pasta do projeto.');
  }

  if (!enabled) {
    if (existsSync(LINK)) await unlink(LINK);
    return startupStatus();
  }

  // O atalho aponta direto para o Shadow.bat, com a janela minimizada
  // (WindowStyle 7). Apontar para o .bat evita passar comando dentro de
  // comando — cada nível de aspas a mais é um jeito novo de quebrar.
  const esc = (s) => s.replace(/'/g, "''");
  await powershell(
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${esc(LINK)}'); ` +
    `$s.TargetPath = '${esc(BAT)}'; ` +
    `$s.WorkingDirectory = '${esc(ROOT_DIR)}'; ` +
    `$s.WindowStyle = 7; ` +
    `$s.Description = 'Inicia o Shadow junto com o Windows'; ` +
    `$s.Save()`
  );
  return startupStatus();
}
