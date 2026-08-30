// SHADOW — processo principal do aplicativo de desktop (Electron).
//
// O que ele faz:
//   1. Sobe o motor (server/index.js) como processo filho, usando o Node que já
//      vem dentro do Electron. Nada de pedir Node.js instalado no PC.
//   2. Espera a porta responder e só então abre a janela — nunca aparece a tela
//      de "localhost recusou a conexão".
//   3. Ícone na bandeja, iniciar com o Windows e iniciar minimizado.
//
// É CommonJS (.cjs) de propósito: o package.json do projeto é "type": "module"
// e o processo principal do Electron fica mais previsível assim.

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'index.js');
const PORT = Number(process.env.PORT) || 4577;
const URL_APP = `http://localhost:${PORT}`;
const ICON = path.join(ROOT, 'public', 'logo.png');

// --hidden: começa só na bandeja (usado quando o Windows inicia o Shadow).
const comecarEscondido =
  process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;

let win = null;
let tray = null;
let motor = null;
let saindo = false;

// Uma instância só: abrir de novo apenas traz a janela existente para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', mostrarJanela);
  app.whenReady().then(iniciar);
}

// ---------- Motor ----------

/** A porta já está respondendo? (motor aberto pelo Shadow.bat, por exemplo) */
function portaAtiva(porta = PORT, timeout = 400) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const fim = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout);
    s.once('connect', () => fim(true));
    s.once('timeout', () => fim(false));
    s.once('error', () => fim(false));
    s.connect(porta, '127.0.0.1');
  });
}

async function esperarMotor(tentativas = 120) {
  for (let i = 0; i < tentativas; i++) {
    if (await portaAtiva()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let reiniciosSeguidos = 0;
let religarTimer = null;

async function subirMotor() {
  if (motor) return;
  if (await portaAtiva()) return; // já tem um motor no ar; aproveitamos ele

  motor = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // roda o Electron como se fosse o node
      SHADOW_LAUNCH: '0',        // a janela é nossa; o .bat não precisa abrir nada
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  motor.stdout?.on('data', (d) => process.stdout.write(d));
  motor.stderr?.on('data', (d) => process.stderr.write(d));

  // Se o motor cai, a janela continua aberta e TUDO passa a dar
  // "Failed to fetch" — o app parece quebrado sem estar. Então ele é
  // ressuscitado aqui, e a tela avisa enquanto isso acontece.
  motor.on('exit', (code) => {
    motor = null;
    if (saindo) return;
    console.error(`[motor] encerrou com código ${code} — reiniciando…`);
    avisarJanela('motor-caiu');
    religarMotor();
  });
}

function religarMotor() {
  clearTimeout(religarTimer);
  // Espera crescente (1s, 2s, 4s… até 15s) para não entrar em loop de tela.
  const espera = Math.min(1000 * 2 ** reiniciosSeguidos, 15000);
  reiniciosSeguidos++;
  religarTimer = setTimeout(async () => {
    if (saindo) return;
    await subirMotor();
    const vivo = await esperarMotor(20);
    if (vivo) {
      reiniciosSeguidos = 0;
      avisarJanela('motor-voltou');
      win?.webContents.reload(); // recarrega para tudo voltar do zero
    } else {
      religarMotor();
    }
  }, espera);
}

/** Manda um recado para a interface (ela escuta em window.shadowDesktop). */
function avisarJanela(evento) {
  try { win?.webContents.send('shadow:motor', evento); } catch { /* janela fechada */ }
}

/** Vigia a porta: se o motor sumir sem o processo morrer, também religa. */
function vigiarMotor() {
  setInterval(async () => {
    if (saindo || religarTimer) return;
    if (await portaAtiva()) return;
    if (motor) return; // o evento 'exit' cuida deste caso
    console.error('[motor] a porta parou de responder — reiniciando…');
    avisarJanela('motor-caiu');
    religarMotor();
  }, 5000);
}

// ---------- Janela ----------

// O Chromium pede permissão para microfone, notificação e localização. Num
// navegador quem responde é o usuário; aqui somos nós. Como a página é a NOSSA
// (localhost), liberamos só o que o Shadow usa — e negamos o resto.
const PERMISSOES_OK = new Set(['media', 'audioCapture', 'notifications', 'geolocation']);

function liberarPermissoes(ses) {
  const daNossaCasa = (url) => String(url || '').startsWith(URL_APP);
  ses.setPermissionRequestHandler((wc, permissao, callback) => {
    callback(PERMISSOES_OK.has(permissao) && daNossaCasa(wc?.getURL()));
  });
  ses.setPermissionCheckHandler((_wc, permissao, origem) =>
    PERMISSOES_OK.has(permissao) && daNossaCasa(origem)
  );
}

function criarJanela() {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#04020a',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  liberarPermissoes(win.webContents.session);
  win.loadURL(URL_APP);
  win.once('ready-to-show', () => { if (!comecarEscondido) win.show(); });

  // Links externos (login do Spotify, por exemplo) vão para o navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(URL_APP)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Fechar no X esconde na bandeja; sair mesmo é pelo menu da bandeja.
  win.on('close', (e) => {
    if (saindo) return;
    e.preventDefault();
    win.hide();
  });
}

function mostrarJanela() {
  if (!win) return criarJanela();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function criarBandeja() {
  const img = nativeImage.createFromPath(ICON);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  tray.setToolTip('Shadow — assistente pessoal');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir o Shadow', click: mostrarJanela },
      { type: 'separator' },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => definirAutoStart(item.checked),
      },
      { type: 'separator' },
      { label: 'Sair', click: sair },
    ])
  );
  tray.on('double-click', mostrarJanela);
}

function sair() {
  saindo = true;
  try { motor?.kill(); } catch { /* já morreu */ }
  app.quit();
}

// ---------- Iniciar com o Windows ----------

function definirAutoStart(ligado) {
  app.setLoginItemSettings({
    openAtLogin: !!ligado,
    openAsHidden: !!ligado,        // macOS
    args: ligado ? ['--hidden'] : [], // Windows: sobe direto para a bandeja
  });
  return app.getLoginItemSettings().openAtLogin;
}

ipcMain.handle('shadow:autostart-get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('shadow:autostart-set', (_e, ligado) => definirAutoStart(ligado));
ipcMain.handle('shadow:hide', () => { win?.hide(); return true; });
ipcMain.handle('shadow:quit', () => { sair(); return true; });

// ---------- Ciclo de vida ----------

async function iniciar() {
  await subirMotor();
  await esperarMotor();
  criarJanela();
  criarBandeja();
  vigiarMotor();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
}

app.on('window-all-closed', () => { /* fica na bandeja; sair é pelo menu */ });
app.on('before-quit', () => { saindo = true; });
app.on('quit', () => { try { motor?.kill(); } catch { /* noop */ } });
