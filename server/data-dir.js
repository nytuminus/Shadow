// Onde o Shadow guarda o que é seu: lembretes, comandos salvos, histórico de
// partidas e a sessão do Spotify.
//
// Rodando pela pasta do projeto (Shadow.bat / npm start), fica em server/data,
// como sempre foi.
//
// Rodando como APLICATIVO INSTALADO, isso não serve: a pasta do programa é
// substituída inteira a cada atualização, e o histórico ia junto. Então os
// dados moram em %APPDATA%\Shadow\data — e, na primeira vez, o que existir na
// pasta do programa é copiado para lá.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPackagedApp } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PASTA_DO_PROJETO = join(__dirname, 'data');

export const DATA_DIR =
  isPackagedApp && process.env.APPDATA
    ? join(process.env.APPDATA, 'Shadow', 'data')
    : PASTA_DO_PROJETO;

/** Caminho de um arquivo de dados. */
export const dataFile = (nome) => join(DATA_DIR, nome);

/** Garante a pasta (e traz os dados antigos na primeira execução do app). */
export async function ensureDataDir() {
  if (existsSync(DATA_DIR)) return DATA_DIR;
  await mkdir(DATA_DIR, { recursive: true });

  if (DATA_DIR !== PASTA_DO_PROJETO && existsSync(PASTA_DO_PROJETO)) {
    try {
      for (const nome of await readdir(PASTA_DO_PROJETO)) {
        if (!nome.endsWith('.json')) continue;
        await copyFile(join(PASTA_DO_PROJETO, nome), join(DATA_DIR, nome));
      }
      console.log(`     Dados migrados para ${DATA_DIR}`);
    } catch (err) {
      console.error('[dados]', err?.message || err);
    }
  }
  return DATA_DIR;
}
