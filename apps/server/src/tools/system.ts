import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Ações que o Shadow pode executar no Windows.
 * Tudo aqui é deliberadamente específico e seguro — abrir apps, pastas e sites.
 * Não expomos execução de comandos arbitrários por segurança.
 */

// Mapa de nomes falados -> comando/alvo para abrir apps comuns do Windows.
const APP_MAP: Record<string, string> = {
  // Navegadores
  'chrome': 'start "" chrome',
  'google chrome': 'start "" chrome',
  'navegador': 'start "" chrome',
  'edge': 'start "" msedge',
  'microsoft edge': 'start "" msedge',
  // Utilitários do Windows
  'bloco de notas': 'start "" notepad',
  'notepad': 'start "" notepad',
  'calculadora': 'start "" calc',
  'calc': 'start "" calc',
  'explorador de arquivos': 'start "" explorer',
  'explorador': 'start "" explorer',
  'arquivos': 'start "" explorer',
  'paint': 'start "" mspaint',
  'terminal': 'start "" wt',
  'prompt de comando': 'start "" cmd',
  'powershell': 'start "" powershell',
  'gerenciador de tarefas': 'start "" taskmgr',
  'configuracoes': 'start "" ms-settings:',
  'configurações': 'start "" ms-settings:',
  'painel de controle': 'start "" control',
  'camera': 'start "" microsoft.windows.camera:',
  'câmera': 'start "" microsoft.windows.camera:',
  // Office
  'word': 'start "" winword',
  'excel': 'start "" excel',
  'powerpoint': 'start "" powerpnt',
  'outlook': 'start "" outlook',
  // Comuns (abrem web se o app não existir)
  'spotify': 'start "" spotify',
  'discord': 'start "" discord',
  'steam': 'start "" steam',
};

// Sites conhecidos por apelido -> URL, para "abrir o youtube" etc.
const SITE_MAP: Record<string, string> = {
  'youtube': 'https://www.youtube.com',
  'google': 'https://www.google.com',
  'gmail': 'https://mail.google.com',
  'whatsapp': 'https://web.whatsapp.com',
  'chatgpt': 'https://chat.openai.com',
  'claude': 'https://claude.ai',
  'github': 'https://github.com',
  'netflix': 'https://www.netflix.com',
  'instagram': 'https://www.instagram.com',
  'twitch': 'https://www.twitch.tv',
  'maps': 'https://maps.google.com',
  'mapa': 'https://maps.google.com',
  'noticias': 'https://news.google.com/?hl=pt-BR',
  'notícias': 'https://news.google.com/?hl=pt-BR',
};

function normalize(str: string): string {
  return String(str || '').trim().toLowerCase();
}

export async function openApplication(name: string): Promise<string> {
  const key = normalize(name);

  // 1) App conhecido
  if (APP_MAP[key]) {
    await execAsync(APP_MAP[key], { windowsHide: true });
    return `Abrindo ${name}.`;
  }

  // 2) Site conhecido por apelido
  if (SITE_MAP[key]) {
    await execAsync(`start "" "${SITE_MAP[key]}"`, { windowsHide: true });
    return `Abrindo ${name}.`;
  }

  // 3) Tentativa genérica: deixar o Windows resolver o nome.
  const safe = key.replace(/["`]/g, '');
  await execAsync(`start "" "${safe}"`, { windowsHide: true });
  return `Tentando abrir ${name}.`;
}

export async function openWebsite(urlOrQuery: string): Promise<string> {
  let target = String(urlOrQuery || '').trim();
  const key = normalize(target);

  if (SITE_MAP[key]) {
    target = SITE_MAP[key];
  } else if (!/^https?:\/\//i.test(target) && /\.[a-z]{2,}(\/|$)/i.test(target)) {
    // Parece um domínio sem protocolo (ex.: "globo.com")
    target = 'https://' + target;
  } else if (!/^https?:\/\//i.test(target)) {
    // Não é uma URL -> pesquisar no Google
    target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
  }

  const safe = target.replace(/["`]/g, '');
  await execAsync(`start "" "${safe}"`, { windowsHide: true });
  return `Abrindo ${target}.`;
}

export async function openFolder(pathValue: string): Promise<string> {
  const raw = String(pathValue || '').trim();
  const shortcuts: Record<string, string> = {
    'documentos': '%USERPROFILE%\\Documents',
    'downloads': '%USERPROFILE%\\Downloads',
    'imagens': '%USERPROFILE%\\Pictures',
    'fotos': '%USERPROFILE%\\Pictures',
    'area de trabalho': '%USERPROFILE%\\Desktop',
    'área de trabalho': '%USERPROFILE%\\Desktop',
    'desktop': '%USERPROFILE%\\Desktop',
    'musica': '%USERPROFILE%\\Music',
    'música': '%USERPROFILE%\\Music',
    'videos': '%USERPROFILE%\\Videos',
    'vídeos': '%USERPROFILE%\\Videos',
  };
  const target = shortcuts[normalize(raw)] || raw;
  const safe = target.replace(/["`]/g, '');
  await execAsync(`explorer "${safe}"`, { windowsHide: true });
  return `Abrindo a pasta ${raw}.`;
}

export function getSystemInfo() {
  return {
    os: `${process.platform}`,
    hora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    uptime_segundos: Math.round(process.uptime()),
  };
}
