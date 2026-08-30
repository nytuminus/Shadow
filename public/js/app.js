import { HUD } from './hud.js';
import { Voice } from './voice.js';
import { linhaDupla, barrasComparadas, barrasJogadores, medidor } from './charts.js';

const $ = (id) => document.getElementById(id);

const els = {
  reactor: $('reactor'),
  stateText: $('state-text'),
  micBtn: $('mic-btn'),
  textForm: $('text-form'),
  textInput: $('text-input'),
  transcript: $('transcript'),
  clock: $('clock'),
  statusDot: $('status-dot'),
  statusLabel: $('status-label'),
  modelLabel: $('model-label'),
  requireWake: $('require-wake'),
  remindersList: $('reminders-list'),
  reminderOverlay: $('reminder-overlay'),
  reminderMessage: $('reminder-message'),
  reminderDismiss: $('reminder-dismiss'),
  setupBanner: $('setup-banner'), setupText: $('setup-text'),
  apikeyForm: $('apikey-form'), apikeyInput: $('apikey-input'),
  brandName: $('brand-name'),
  engineSel: $('voice-engine'),
  neuralSel: $('voice-neural'),
  browserSel: $('voice-browser'),
  voiceTest: $('voice-test'),
  voiceRepeat: $('voice-repeat'),
  voiceTag: $('voice-tag'),
  // Volume da voz (no card e no rodapé — sempre à mão)
  volSlider: $('voice-volume'), volVal: $('voice-volume-val'), volMute: $('voice-mute'),
  dockVol: $('dock-volume'), dockMute: $('dock-mute'),
  // Aplicativo / iniciar com o Windows
  appMode: $('app-mode'), appHint: $('app-hint'),
  startupRow: $('startup-row'), startupToggle: $('startup-toggle'),
  browserRow: $('voice-browser-row'),
  neuralRow: $('voice-neural-row'),
  reminderTime: $('reminder-time'),
  toasts: $('toasts'),
  // Monitor
  hdrHost: $('hdr-host'),
  uptime: $('uptime'),
  cpuPct: $('cpu-pct'), cpuBar: $('cpu-bar'), cpuNote: $('cpu-note'),
  ramPct: $('ram-pct'), ramBar: $('ram-bar'), ramNote: $('ram-note'),
  gpuTemp: $('gpu-temp'), gpuBar: $('gpu-bar'), gpuNote: $('gpu-note'), gpuBlock: $('gpu-block'),
  diskPct: $('disk-pct'), diskBar: $('disk-bar'), diskNote: $('disk-note'),
  chipCpuTemp: $('chip-cputemp'), chipBattery: $('chip-battery'),
  miniCpu: $('mini-cpu'), miniRam: $('mini-ram'), miniGpu: $('mini-gpu'), miniWeather: $('mini-weather'),
  // Clima
  weatherCity: $('weather-city'), weatherEmoji: $('weather-emoji'), weatherTemp: $('weather-temp'),
  weatherDesc: $('weather-desc'), weatherFeels: $('weather-feels'), weatherMinmax: $('weather-minmax'),
  weatherHum: $('weather-hum'), weatherWind: $('weather-wind'), weatherRain: $('weather-rain'),
  // Comandos salvos
  commandsList: $('commands-list'), commandForm: $('command-form'),
  cmdTrigger: $('cmd-trigger'), cmdAction: $('cmd-action'), cmdCount: $('cmd-count'),
  // Modo Jogo (LoL)
  gamesBtn: $('games-btn'), gameDeck: $('game-deck'), gameClose: $('gd-close'),
  gdMode: $('gd-mode'), gdMe: $('gd-me'), gdGraficos: $('gd-graficos'),
  gdPerf: $('gd-perf'), gdFpsNota: $('gd-fps-nota'),
  lolClock: $('lol-clock'), lolOffline: $('lol-offline'), lolLive: $('lol-live'),
  lolChamp: $('lol-champ'), lolKda: $('lol-kda'), lolLevel: $('lol-level'), lolCs: $('lol-cs'),
  lolGold: $('lol-gold'), lolHp: $('lol-hp'), lolDragon: $('lol-dragon'), lolBaron: $('lol-baron'),
  lolTowers: $('lol-towers'), lolOrder: $('lol-order'), lolChaos: $('lol-chaos'),
  lolKp: $('lol-kp'),
  lolTips: $('lol-tips'), lolCoachBtn: $('lol-coach-btn'), lolVoice: $('lol-voice'),
  lolAllies: $('lol-allies'), lolEnemies: $('lol-enemies'), lolJungler: $('lol-jungler'),
  lolBuildBtn: $('lol-build-btn'),
  lolReplay: $('lol-replay'), lolStop: $('lol-stop'),
  lolHistory: $('lol-history'), lolHistCount: $('lol-hist-count'),
  lolHistSummary: $('lol-hist-summary'),
  // Spotify
  spState: $('sp-state'), spDisconnected: $('sp-disconnected'), spConnected: $('sp-connected'),
  spConnect: $('sp-connect'), spNotConfigured: $('sp-notconfigured'),
  spArt: $('sp-art'), spTrack: $('sp-track'), spArtist: $('sp-artist'),
  spPrev: $('sp-prev'), spPlayPause: $('sp-playpause'), spNext: $('sp-next'),
  spVol: $('sp-vol'), spSearchForm: $('sp-search-form'), spSearch: $('sp-search'),
};

// Existe quando o Shadow roda como aplicativo instalado (Electron):
// é a ponte para "iniciar com o Windows" e a bandeja. Ver desktop/preload.cjs.
const desktop = window.shadowDesktop || null;

let savedCommands = [];
let spConnected = false;
let spPlaying = false;
let gameMode = false;
let lolTimer = null;
let lastLolState = null;
let lolHistory = [];
let speakingHistoryId = null; // qual partida está sendo lida em voz alta
let perfTimer = null;
let ultimoFps = null;
// Cada leitura da partida vira um ponto: é daqui que saem os gráficos de
// evolução (a API da Riot só dá o "agora", não o histórico).
let linhaDoTempo = [];
const spokenTips = new Set();

let ready = false;
let busy = false;
let active = false;
let armed = false;
let armTimer = null;
let assistantName = 'Shadow';
let wakeName = 'shadow';
let catchphrase = 'O que é, desgraça?';

// Como o reconhecimento em pt-BR costuma entender "Shadow" errado.
const MISHEARS = [
  'shado', 'shadou', 'shadow', 'chadou', 'chado', 'chadow', 'xadow', 'xadu',
  'chaddo', 'shadu', 'shadown', 'shadaw', 'jadou',
];

// ---------- Inicialização ----------
HUD.init(els.reactor);
Voice.init();
wireVoice();
wireControls();
startClock();
loadStatus();
loadReminders();
connectEvents();
wireCommands();
startMonitor();
startWeather();
loadCommands();
requestNotifyPermission();
wireGames();
wireSpotify();
startSpotify();
wireVolume();
setupAppCard();

if (!Voice.supported) {
  els.micBtn.disabled = true;
  els.micBtn.title = 'Reconhecimento de voz indisponível neste navegador';
  setState('idle', 'Digite seu comando');
} else {
  setState('idle', 'Toque no microfone para ativar');
}

// ---------- Estado visual ----------
function setState(state, text) {
  HUD.setState(state);
  els.stateText.className =
    'state-text ' + (['listening', 'armed', 'speaking'].includes(state) ? state : '');
  if (text != null) els.stateText.textContent = text;
  const armedNow = state === 'armed';
  els.micBtn.classList.toggle('listening', armedNow);
  els.micBtn.classList.toggle('active', active && !armedNow && state !== 'idle');
  // O reator vive no fundo: só ganha brilho quando o Shadow está em ação.
  document.body.classList.toggle('core-live', state !== 'idle');
}

function waitText() {
  return els.requireWake.checked ? `Diga "${assistantName}"…` : 'Ouvindo…';
}

// ---------- Voz / palavra de ativação ----------
function wireVoice() {
  Voice.onLevel = (lvl) => HUD.setLevel(lvl);

  Voice.onActiveChange = (on) => {
    active = on;
    if (on) setState('listening', waitText());
    else setState('idle', 'Toque no microfone para ativar');
  };

  Voice.onListenStart = () => {
    if (active && !busy && !armed) setState('listening', waitText());
  };

  // A voz local sai em ~0,3s; só vale avisar quando for o Gemini, que demora.
  Voice.onSynthStart = (engine) => {
    if (engine === 'gemini') setState('thinking', 'Gerando voz…');
  };
  Voice.onSpeakStart = () => setState('speaking', 'Falando…');
  Voice.onSpeakEnd = () => {
    markHistorySpeaking(null);
    if (!active) {
      setState('idle', 'Toque no microfone para ativar');
      return;
    }
    Voice.resumeListening();
    if (armed) {
      setState('armed', 'Sim? Estou ouvindo…');
      rearm(); // a janela de comando só começa a contar depois que ele cala
    } else {
      setState('listening', waitText());
    }
  };

  const NOME_MOTOR = { local: 'local', gemini: 'gemini', browser: 'navegador' };
  Voice.onEngineUsed = (engine) => {
    els.voiceTag.textContent = NOME_MOTOR[engine] || engine;
    els.voiceTag.className = 'voice-tag ' + engine;
  };

  // No modo aplicativo, entre você falar e o texto chegar existe uma ida ao
  // Gemini. Sem avisar, parece que ele travou.
  Voice.onCapture = (gravando) => {
    if (!active || busy) return;
    if (gravando) setState('listening', 'Ouvindo você…');
    else if (!armed) setState('listening', waitText());
  };

  Voice.onSttThinking = (on) => {
    if (on && active && !busy && !armed) setState('thinking', 'Entendendo…');
    else if (!on && active && !busy && !armed) setState('listening', waitText());
  };

  Voice.onListenerChange = (qual) => {
    if (qual === 'servidor') {
      showToast('🎙️ Escuta pelo Gemini', 'A escuta do navegador falhou; passei a transcrever pelo Gemini.', '');
      renderListener();
    }
  };

  Voice.onError = (err) => {
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      active = false;
      setState('idle', 'Permita o microfone e tente de novo');
      return;
    }
    if (err === 'sem-microfone' || err === 'sem-gravador') {
      active = false;
      setState('idle', 'Não achei um microfone utilizável');
      showToast('🎙️ Sem microfone', 'Confira se o microfone está conectado e liberado.', 'warn');
      return;
    }
    if (String(err).startsWith('stt:')) {
      // Falha isolada de transcrição: avisa sem derrubar a escuta.
      showToast('🎙️ Não entendi', 'Falha ao transcrever o áudio. Fale de novo.', 'warn');
    }
  };

  Voice.onPhrase = handlePhrase;
}

/**
 * @param {string} text  o que foi ouvido
 * @param {{chamou?: boolean}} info  no modo aplicativo, o julgamento de quem
 *   ouviu o ÁUDIO sobre você ter chamado pelo nome (a transcrição erra o nome).
 */
function handlePhrase(text, info = {}) {
  if (busy) return;

  // Já ouvimos "Shadow" antes: esta frase é o comando.
  if (armed) {
    clearTimeout(armTimer);
    armed = false;
    dispatch(text);
    return;
  }

  // Sem exigir a palavra: age em qualquer fala.
  if (!els.requireWake.checked) {
    dispatch(text);
    return;
  }

  // Procura a palavra de ativação na frase.
  const words = normalize(text).split(/\s+/).filter(Boolean);
  const origWords = text.split(/\s+/).filter(Boolean);
  let idx = words.findIndex(isWake);

  if (idx === -1) {
    // O nome não apareceu no texto. Se quem ouviu o áudio garante que você
    // chamou, a primeira palavra é o nome escrito errado ("Cadê", "Gato").
    if (!info.chamou) return;
    idx = 0;
  }

  const after = origWords.slice(idx + 1).join(' ').trim();
  if (after.length >= 2) {
    dispatch(after); // "Shadow, faça X"
  } else {
    // Só chamou "Shadow" → responde o bordão e espera o comando.
    armed = true;
    setState('armed', 'Sim? Estou ouvindo…');
    addMessage('jarvis', catchphrase);
    Voice.pauseListening();
    Voice.speak(catchphrase);
    rearm();
  }
}

/** (Re)inicia a janela em que a próxima frase vale como comando. */
function rearm(ms = 12000) {
  clearTimeout(armTimer);
  armTimer = setTimeout(() => {
    armed = false;
    if (active && !busy) setState('listening', waitText());
  }, ms);
}

function isWake(w) {
  if (w === wakeName || MISHEARS.includes(w)) return true;
  // Prefixo só vale para palavras do TAMANHO do nome. Com 3 letras ("sha"),
  // qualquer "shampoo" da vida acordava o Shadow.
  const p = wakeName.slice(0, 4);
  return p.length >= 4 && w.length >= wakeName.length - 1 && w.startsWith(p);
}

function dispatch(command, { matchSaved = true } = {}) {
  // Comando salvo? Executa a ação dele em vez do texto cru.
  if (matchSaved) {
    const cmd = findSavedCommand(command);
    if (cmd) { runSavedCommand(cmd); return; }
  }
  addMessage('user', command);
  Voice.pauseListening();
  sendToShadow(command);
}

// ---------- Controles ----------
function wireControls() {
  els.micBtn.addEventListener('click', () => {
    if (!Voice.supported) return;
    Voice.toggle();
  });

  els.textForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.textInput.value.trim();
    if (!text) return;
    els.textInput.value = '';
    dispatch(text);
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement !== els.textInput && Voice.supported) {
      e.preventDefault();
      els.micBtn.click();
    }
  });

  els.requireWake.addEventListener('change', () => {
    if (active && !busy && !armed) setState('listening', waitText());
  });

  els.reminderDismiss.addEventListener('click', () => {
    els.reminderOverlay.classList.add('hidden');
    Voice.cancelSpeak();
  });

  els.engineSel.addEventListener('change', () => {
    Voice.setEngine(els.engineSel.value);
    syncVoiceRows();
  });
  els.neuralSel.addEventListener('change', () => Voice.setNeuralVoice(els.neuralSel.value));
  els.browserSel.addEventListener('change', () => Voice.setBrowserVoice(els.browserSel.value));
  els.voiceTest.addEventListener('click', () => {
    Voice.pauseListening();
    Voice.speak(`${catchphrase} Sou o ${assistantName}. É assim que eu soo.`);
  });
  els.voiceRepeat.addEventListener('click', repeatLastSpeech);

  // Salvar a chave da API pela própria tela: no app instalado não dá para
  // pedir que o usuário vá caçar um arquivo .env no meio do AppData.
  els.apikeyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = els.apikeyInput.value.trim();
    if (!key) return;
    const btn = els.apikeyForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    try {
      const res = await fetch('/api/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não consegui salvar.');
      els.apikeyInput.value = '';
      showToast('🔑 Chave salva', 'Pronto, já posso pensar e ouvir.', '');
      await loadStatus(); // some com o aviso e liga o "online"
    } catch (err) {
      showToast('⚠️ Chave recusada', err.message || 'Tente de novo.', 'warn');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar chave';
    }
  });
}

/** Repete a última coisa que o Shadow falou. */
function repeatLastSpeech() {
  Voice.pauseListening();
  if (!Voice.repeat()) {
    showToast('🔊 Nada para repetir', 'Ainda não falei nada nesta sessão.', '');
  }
}

// ==================================================================
//  VOLUME DA VOZ
//  Dois controles ligados no mesmo valor: um no card de Voz e um no
//  rodapé, para abaixar o Shadow sem procurar nada.
// ==================================================================
function wireVolume() {
  const aplicar = (pct) => {
    Voice.setVolume(pct / 100);
    renderVolume();
  };
  for (const s of [els.volSlider, els.dockVol]) {
    s.addEventListener('input', () => aplicar(Number(s.value)));
  }
  for (const b of [els.volMute, els.dockMute]) {
    b.addEventListener('click', () => {
      Voice.toggleMute();
      renderVolume();
    });
  }
  renderVolume();
}

function renderVolume() {
  const pct = Math.round(Voice.volume * 100);
  const ico = pct === 0 ? '🔇' : pct < 35 ? '🔈' : pct < 75 ? '🔉' : '🔊';
  for (const s of [els.volSlider, els.dockVol]) {
    s.value = pct;
    s.style.setProperty('--fill', pct + '%'); // preenche a trilha do slider
  }
  for (const b of [els.volMute, els.dockMute]) {
    b.textContent = ico;
    b.classList.toggle('muted', pct === 0);
    b.title = pct === 0 ? 'Voltar o som' : 'Silenciar a voz';
  }
  els.volVal.textContent = pct + '%';
}

// ==================================================================
//  APLICATIVO — modo app (Electron) e iniciar com o Windows
// ==================================================================
// ---------- Motor fora do ar ----------
let motorOffline = false;
let voltaTimer = null;

function motorCaiu() {
  if (motorOffline) return;
  motorOffline = true;
  els.statusDot.className = 'dot offline';
  els.statusLabel.textContent = 'motor fora';
  showToast('🔌 Motor fora do ar', desktop
    ? 'O motor do Shadow caiu. Estou reabrindo ele sozinho.'
    : 'O motor do Shadow não respondeu. Abra o Shadow.bat de novo.', 'warn');
  // Fica testando até ele voltar, para a tela se recuperar sozinha.
  clearInterval(voltaTimer);
  voltaTimer = setInterval(async () => {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) return;
      clearInterval(voltaTimer);
      motorOffline = false;
      showToast('⚡ Motor de volta', 'Tudo funcionando de novo.', '');
      loadStatus();
    } catch { /* ainda fora */ }
  }, 3000);
}

/** Conta, no card Aplicativo, quem está ouvindo o microfone. */
function renderListener() {
  if (!desktop) return;
  const porGemini = Voice.listener === 'servidor';
  els.appHint.innerHTML =
    'Fechar na janela manda o Shadow para a <b>bandeja</b>, ao lado do relógio — ' +
    'ele continua ouvindo.' +
    (porGemini
      ? '<br>🎙️ Microfone: <b>transcrição pelo Gemini</b> (a escuta do Chrome não ' +
        'funciona dentro de um aplicativo, então eu gravo o trecho e mando transcrever).'
      : '');
}

async function setupAppCard() {
  if (desktop) {
    els.appMode.textContent = 'aplicativo';
    els.appMode.className = 'card-sub on';
    renderListener();
    // O app avisa quando o motor cai e quando volta.
    desktop.onMotor?.((evento) => {
      if (evento === 'motor-caiu') motorCaiu();
      else if (evento === 'motor-voltou') showToast('⚡ Motor de volta', 'Reabri o motor do Shadow.', '');
    });
    try {
      els.startupToggle.checked = await desktop.getAutoStart();
    } catch { /* sem resposta: deixa desmarcado */ }
    els.startupToggle.addEventListener('change', async () => {
      const on = els.startupToggle.checked;
      const real = await desktop.setAutoStart(on);
      els.startupToggle.checked = !!real;
      showToast(
        on ? '🚀 Vai iniciar com o Windows' : '💤 Não inicia mais sozinho',
        on ? 'O Shadow abre na bandeja assim que você ligar o PC.' : 'Você abre o Shadow quando quiser.',
        ''
      );
    });
    return;
  }

  // Modo navegador: quem cria o atalho na pasta Inicializar é o motor.
  els.appMode.textContent = 'navegador';
  els.appHint.innerHTML =
    'Para virar um app de verdade (ícone, bandeja e sem barra de navegador), ' +
    'rode <b>npm run dist</b> uma vez e instale o <b>Shadow Setup</b> que aparece na pasta <b>instalador</b>.';
  try {
    const s = await (await fetch('/api/startup')).json();
    els.startupToggle.checked = !!s.enabled;
    if (!s.supported) {
      els.startupRow.classList.add('off');
      els.startupToggle.disabled = true;
    }
  } catch { /* motor ocupado */ }

  els.startupToggle.addEventListener('change', async () => {
    const enabled = els.startupToggle.checked;
    try {
      const res = await fetch('/api/startup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const s = await res.json();
      if (s.error) throw new Error(s.error);
      els.startupToggle.checked = !!s.enabled;
      showToast(
        enabled ? '🚀 Vai iniciar com o Windows' : '💤 Não inicia mais sozinho',
        enabled ? 'Criei um atalho na pasta Inicializar do Windows.' : 'Removi o atalho da pasta Inicializar.',
        ''
      );
    } catch (err) {
      els.startupToggle.checked = !enabled;
      showToast('⚠️ Erro', err.message || 'Não consegui mexer na inicialização.', 'warn');
    }
  });
}

// ---------- Painel de voz ----------
function setupVoicePanel() {
  // Some do menu o que não está disponível neste PC.
  for (const opt of els.engineSel.options) {
    opt.disabled = !Voice.engineAvailable(opt.value);
    opt.hidden = opt.disabled;
  }
  els.engineSel.value = Voice.engine;

  els.neuralSel.innerHTML = Voice.neural.voices
    .map(
      (v) =>
        `<option value="${escapeHtml(v.id)}"${v.id === Voice.neural.voice ? ' selected' : ''}>${escapeHtml(v.label)}</option>`
    )
    .join('');

  const fillBrowser = () => {
    const list = Voice.listBrowserVoices();
    if (!list.length) return;
    const current = Voice.ptVoice?.name;
    els.browserSel.innerHTML = list
      .map((v) => {
        const natural = /natural|online|neural/i.test(v.name);
        const label = v.name.replace(/ - Portuguese \(Brazil\)/i, '') + (natural ? ' ★' : '');
        return `<option value="${escapeHtml(v.name)}"${v.name === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('');
  };
  fillBrowser();
  if (window.speechSynthesis) {
    // As vozes de rede do Edge só aparecem depois de um instante.
    setTimeout(fillBrowser, 1200);
    setTimeout(fillBrowser, 3000);
  }

  syncVoiceRows();
}

function syncVoiceRows() {
  // O seletor de timbre só faz sentido para as vozes do Gemini.
  els.neuralRow.classList.toggle('hidden', Voice.engine !== 'gemini');
}

// ---------- Comunicação com o motor ----------
async function sendToShadow(text) {
  if (busy) return;
  if (!ready) {
    const msg =
      'Preciso de uma chave do Google Gemini para pensar. Pegue uma grátis em ' +
      'aistudio.google.com/apikey, coloque no arquivo .env e me reinicie.';
    addMessage('jarvis', msg);
    Voice.speak(msg);
    return;
  }
  busy = true;
  Voice.setThinking(true);
  setState('thinking', 'Pensando…');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Falha na comunicação.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) handleEvent(JSON.parse(line));
      }
    }
  } catch (err) {
    busy = false;
    Voice.setThinking(false);
    const msg = mensagemDeErro(err);
    addMessage('jarvis', msg);
    Voice.speak(msg);
  }
}

/**
 * Traduz a falha para algo que uma pessoa entenda.
 * "Failed to fetch" quer dizer que o motor do Shadow não respondeu — e é isso
 * que a tela precisa dizer, em vez de despejar o erro do navegador.
 */
function mensagemDeErro(err) {
  const cru = String(err?.message || err || '');
  if (/failed to fetch|networkerror|load failed|fetch/i.test(cru)) {
    motorCaiu();
    return desktop
      ? 'Perdi contato com o meu motor. Já estou reabrindo ele — tente de novo em alguns segundos.'
      : 'Perdi contato com o meu motor. Confira se a janela preta do Shadow ainda está aberta.';
  }
  return 'Desculpe, ' + (cru || 'algo deu errado.');
}

function handleEvent(evt) {
  switch (evt.type) {
    case 'status':
      setState('thinking', evt.text || 'Pensando…');
      break;
    case 'tool':
      setState('thinking', evt.text || 'Executando…');
      addMessage('tool', evt.text || evt.name);
      if (evt.name === 'create_reminder' || evt.name === 'delete_reminder') {
        setTimeout(loadReminders, 400);
      }
      break;
    case 'final':
      busy = false;
      Voice.setThinking(false);
      addMessage('jarvis', evt.text);
      Voice.speak(evt.text);
      break;
    case 'error':
      busy = false;
      Voice.setThinking(false);
      addMessage('jarvis', evt.text);
      Voice.speak(evt.text);
      break;
  }
}

// ---------- Transcrição ----------
function addMessage(kind, text) {
  const who = kind === 'user' ? 'Você' : kind === 'tool' ? 'Sistema' : assistantName;
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + kind;
  if (kind === 'tool') {
    wrap.innerHTML = `<span class="bubble">${escapeHtml(text)}</span>`;
  } else {
    wrap.innerHTML = `<span class="who">${escapeHtml(who)}</span><span class="bubble">${escapeHtml(text)}</span>`;
  }
  els.transcript.appendChild(wrap);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalize(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

// ---------- Status / relógio / lembretes ----------
async function loadStatus() {
  try {
    const s = await (await fetch('/api/status')).json();
    ready = s.ready;
    if (s.assistantName) {
      assistantName = s.assistantName;
      wakeName = normalize(s.assistantName);
      els.brandName.textContent = s.assistantName.toUpperCase();
      document.title = s.assistantName.toUpperCase();
    }
    if (s.catchphrase) catchphrase = s.catchphrase;
    Voice.configureNeural(s.tts);
    setupVoicePanel();
    els.modelLabel.textContent = s.model || '—';
    els.statusDot.className = 'dot ' + (s.ready ? 'online' : 'offline');
    els.statusLabel.textContent = s.ready ? 'online' : 'sem chave';
    els.setupBanner.classList.toggle('hidden', s.ready);
    // Mostra o caminho REAL do .env: no app instalado ele fica no APPDATA,
    // não na pasta do programa.
    if (!s.ready && s.envPath) {
      els.setupText.innerHTML =
        '<strong>Falta configurar a chave da API.</strong> ' +
        'Pegue uma grátis em <code>aistudio.google.com/apikey</code> e cole aqui embaixo — ' +
        'eu salvo em <code>' + escapeHtml(s.envPath) + '</code> e já começo a funcionar.';
    }
  } catch {
    els.statusDot.className = 'dot offline';
    els.statusLabel.textContent = 'offline';
  }
}

async function loadReminders() {
  try {
    const list = await (await fetch('/api/reminders')).json();
    if (!Array.isArray(list) || list.length === 0) {
      els.remindersList.innerHTML = '<li class="muted">nenhum</li>';
      return;
    }
    els.remindersList.innerHTML = list
      .map((r) => {
        const q = new Date(r.time).toLocaleString('pt-BR', {
          hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
        });
        return `<li>${escapeHtml(r.message)} — ${q}</li>`;
      })
      .join('');
  } catch { /* noop */ }
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('reminder', (e) => {
    const r = JSON.parse(e.data);
    els.reminderMessage.textContent = r.message;
    if (els.reminderTime) {
      const q = new Date(r.time).toLocaleString('pt-BR', {
        weekday: 'long', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
      });
      els.reminderTime.textContent = `⏱️ agendado para ${q}`;
    }
    els.reminderOverlay.classList.remove('hidden');
    Voice.pauseListening();
    Voice.speak(`Lembrete: ${r.message}`);
    showToast('⏰ Lembrete', r.message, 'warn');
    loadReminders();
  });
  es.onerror = () => { /* o navegador reconecta sozinho */ };
}

function startClock() {
  const tick = () => {
    els.clock.textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

// ==================================================================
//  MONITOR DO SISTEMA
// ==================================================================
function startMonitor() {
  const poll = async () => {
    try {
      const m = await (await fetch('/api/metrics')).json();
      if (!m.error) renderMetrics(m);
    } catch { /* motor ocupado; tenta de novo no próximo ciclo */ }
  };
  poll();
  setInterval(poll, 3000);
}

// Escolhe a classe (normal/warn/hot) conforme os limites.
function level(value, warn, hot) {
  if (value >= hot) return 'hot';
  if (value >= warn) return 'warn';
  return '';
}

function setBar(barEl, pctEl, pct, cls) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  barEl.style.width = v + '%';
  barEl.className = cls;
  if (pctEl) pctEl.textContent = v + '%';
}

function renderMetrics(m) {
  els.hdrHost.textContent = m.host || '';

  const h = Math.floor(m.uptimeSec / 3600);
  const min = Math.floor((m.uptimeSec % 3600) / 60);
  els.uptime.textContent = `ligado há ${h}h${String(min).padStart(2, '0')}`;

  // CPU
  const cpuCls = level(m.cpu.usage, 75, 92);
  setBar(els.cpuBar, els.cpuPct, m.cpu.usage, cpuCls);
  els.cpuNote.textContent = `${m.cpu.model} · ${m.cpu.cores} núcleos`;

  // RAM
  const ramCls = level(m.ram.percent, 80, 92);
  setBar(els.ramBar, els.ramPct, m.ram.percent, ramCls);
  els.ramNote.textContent = `${m.ram.usedGB} de ${m.ram.totalGB} GB em uso`;

  // GPU
  if (m.gpu) {
    els.gpuBlock.style.display = '';
    const gCls = level(m.gpu.temp, 70, 83);
    els.gpuTemp.textContent = `${m.gpu.temp}°`;
    // A barra da GPU mostra o USO; a cor segue a TEMPERATURA.
    setBar(els.gpuBar, null, m.gpu.util, gCls);
    els.gpuNote.textContent = `${m.gpu.name.replace('NVIDIA ', '')} · uso ${m.gpu.util}% · ${(m.gpu.memUsedMB / 1024).toFixed(1)}/${(m.gpu.memTotalMB / 1024).toFixed(0)} GB`;
    checkAlert('gpu', m.gpu.temp >= 83, 'hot', '🔥 GPU quente', `A GPU está a ${m.gpu.temp}°C.`);
  } else {
    els.gpuBlock.style.display = 'none';
  }

  // Disco
  if (m.disk) {
    const dCls = level(m.disk.percent, 85, 95);
    setBar(els.diskBar, els.diskPct, m.disk.percent, dCls);
    els.diskNote.textContent = `${m.disk.freeGB} GB livres de ${m.disk.totalGB} GB`;
    checkAlert('disk', m.disk.percent >= 95, 'hot', '💾 Disco quase cheio', `Só ${m.disk.freeGB} GB livres no C:.`);
  }

  // Chips: temp de CPU (best-effort) e bateria
  if (m.cpu.temp != null) {
    els.chipCpuTemp.textContent = `CPU ${m.cpu.temp}°`;
    els.chipCpuTemp.className = 'chip' + (m.cpu.temp >= 85 ? ' hot' : '');
  } else {
    els.chipCpuTemp.textContent = 'CPU temp: n/d';
    els.chipCpuTemp.className = 'chip na';
  }
  if (m.battery) {
    els.chipBattery.style.display = '';
    els.chipBattery.textContent = `Bateria ${m.battery.percent}%${m.battery.charging ? ' ⚡' : ''}`;
    els.chipBattery.className = 'chip' + (m.battery.percent <= 15 && !m.battery.charging ? ' hot' : '');
    checkAlert('battery', m.battery.percent <= 15 && !m.battery.charging, 'warn', '🔋 Bateria baixa', `Bateria em ${m.battery.percent}%.`);
  } else {
    els.chipBattery.style.display = 'none';
  }

  // Mini-stats na topbar
  setMini(els.miniCpu, m.cpu.usage + '%', cpuCls);
  setMini(els.miniRam, m.ram.percent + '%', ramCls);
  if (m.gpu) setMini(els.miniGpu, m.gpu.temp + '°', level(m.gpu.temp, 70, 83));
}

function setMini(el, text, cls) {
  el.textContent = text;
  el.className = cls || '';
}

// Dispara um toast só quando a condição fica verdadeira (não a cada ciclo).
const alertState = {};
function checkAlert(key, condition, type, title, msg) {
  const was = alertState[key] || false;
  if (condition && !was) showToast(title, msg, type);
  alertState[key] = condition;
}

// ==================================================================
//  CLIMA
// ==================================================================
function startWeather() {
  const load = (coords) => {
    const q = coords ? `?lat=${coords.lat}&lon=${coords.lon}` : '';
    fetch('/api/weather' + q)
      .then((r) => r.json())
      .then((w) => { if (!w.error) renderWeather(w); else weatherFail(); })
      .catch(weatherFail);
  };

  // Tenta a geolocalização do navegador (mais precisa); senão, cai para IP.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => load({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => load(null),
      { timeout: 6000, maximumAge: 600000 }
    );
  } else {
    load(null);
  }

  // Atualiza a cada 15 minutos (por IP, para não pedir GPS de novo).
  setInterval(() => load(null), 15 * 60 * 1000);
}

function renderWeather(w) {
  els.weatherCity.textContent = w.region ? `${w.city}, ${w.region}` : w.city;
  els.weatherEmoji.textContent = w.emoji;
  els.weatherTemp.textContent = `${w.temp}°`;
  els.weatherDesc.textContent = w.description;
  els.weatherFeels.textContent = `${w.feelsLike}°`;
  els.weatherMinmax.textContent = `${w.min}° / ${w.max}°`;
  els.weatherHum.textContent = `${w.humidity}%`;
  els.weatherWind.textContent = `${w.wind} km/h`;
  els.weatherRain.textContent = w.rainChance != null ? `${w.rainChance}%` : '—';
  els.miniWeather.textContent = `${w.emoji} ${w.temp}°`;
}

function weatherFail() {
  els.weatherDesc.textContent = 'clima indisponível';
  els.miniWeather.textContent = '—';
}

// ==================================================================
//  COMANDOS SALVOS
// ==================================================================
function wireCommands() {
  els.commandForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const trigger = els.cmdTrigger.value.trim();
    const action = els.cmdAction.value.trim();
    if (!trigger || !action) return;
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger, action }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      els.cmdTrigger.value = '';
      els.cmdAction.value = '';
      showToast('💾 Comando salvo', `"${trigger}" pronto para usar.`, '');
      loadCommands();
    } catch (err) {
      showToast('⚠️ Erro', err.message || 'Não consegui salvar.', 'warn');
    }
  });
}

async function loadCommands() {
  try {
    savedCommands = await (await fetch('/api/commands')).json();
  } catch {
    savedCommands = [];
  }
  renderCommands();
}

function renderCommands() {
  els.cmdCount.textContent = savedCommands.length;
  if (!savedCommands.length) {
    els.commandsList.innerHTML = '<li class="muted">nenhum ainda</li>';
    return;
  }
  els.commandsList.innerHTML = '';
  for (const c of savedCommands) {
    const li = document.createElement('li');
    li.className = 'command-item';
    li.innerHTML =
      `<div class="ci-main">
         <div class="ci-trigger">${escapeHtml(c.trigger)}${c.runs ? ` <span class="ci-runs">×${c.runs}</span>` : ''}</div>
         <div class="ci-action">${escapeHtml(c.action)}</div>
       </div>
       <button class="ci-btn run" title="Executar">▶</button>
       <button class="ci-btn del" title="Excluir">✕</button>`;
    li.querySelector('.run').addEventListener('click', () => runSavedCommand(c));
    li.querySelector('.del').addEventListener('click', () => deleteCommand(c));
    els.commandsList.appendChild(li);
  }
}

async function deleteCommand(cmd) {
  try {
    await fetch('/api/commands/' + cmd.id, { method: 'DELETE' });
    showToast('🗑️ Removido', `"${cmd.trigger}" foi excluído.`, '');
    loadCommands();
  } catch { /* noop */ }
}

function findSavedCommand(text) {
  const s = normalize(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  for (const c of savedCommands) {
    const t = normalize(c.trigger).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    // Igual ao gatilho, ou "executa/roda/ativa/liga/inicia <gatilho>".
    const verb = new RegExp(`^(executa[r]?|roda[r]?|ativa[r]?|liga[r]?|inicia[r]?)\\s+(o\\s+|a\\s+)?${escapeReg(t)}$`);
    if (s === t || verb.test(s)) return c;
  }
  return null;
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runSavedCommand(cmd) {
  showToast('▶️ Comando salvo', `Executando "${cmd.trigger}".`, '');
  fetch('/api/commands/' + cmd.id + '/run', { method: 'POST' })
    .then(() => loadCommands())
    .catch(() => {});
  addMessage('user', cmd.trigger);
  addMessage('tool', `Comando salvo → ${cmd.action}`);
  Voice.pauseListening();
  sendToShadow(cmd.action);
}

// ==================================================================
//  NOTIFICAÇÕES (toasts + notificação do sistema)
// ==================================================================
function showToast(title, message, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  // O título vem como "emoji Texto"; separamos no primeiro espaço.
  const sp = title.indexOf(' ');
  const ico = sp > 0 ? title.slice(0, sp) : 'ℹ️';
  const cleanTitle = sp > 0 ? title.slice(sp + 1) : title;
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML =
    `<span class="t-ico">${ico}</span>
     <div class="t-body">
       <div class="t-title">${escapeHtml(cleanTitle)}</div>
       <div>${escapeHtml(message)}</div>
       <div class="t-time">${hora}</div>
     </div>`;
  els.toasts.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, 5000);

  // Se a janela estiver em segundo plano, avisa também pelo sistema.
  if (document.hidden && window.Notification && Notification.permission === 'granted') {
    try { new Notification(cleanTitle, { body: message }); } catch { /* noop */ }
  }
}

function requestNotifyPermission() {
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

// ==================================================================
//  SPOTIFY
// ==================================================================
function wireSpotify() {
  els.spConnect.addEventListener('click', () => {
    window.open('/api/spotify/login', '_blank', 'width=520,height=720');
    showToast('🎵 Spotify', 'Faça login na aba que abriu. Eu detecto quando conectar.', '');
    // Fica checando até conectar (até ~90s).
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      await loadSpotifyStatus();
      if (spConnected || tries > 45) clearInterval(t);
    }, 2000);
  });

  els.spPrev.addEventListener('click', () => spotifyCmd('previous'));
  els.spNext.addEventListener('click', () => spotifyCmd('next'));
  els.spPlayPause.addEventListener('click', () => spotifyCmd(spPlaying ? 'pause' : 'play'));
  els.spVol.addEventListener('change', () => spotifyVolume(Number(els.spVol.value)));
  els.spSearchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = els.spSearch.value.trim();
    if (!q) return;
    els.spSearch.value = '';
    spotifyCmd('play', q);
  });
}

function startSpotify() {
  loadSpotifyStatus();
  // Atualiza o "tocando agora" a cada 5s quando conectado.
  setInterval(() => { if (spConnected) loadSpotifyStatus(); }, 5000);
}

async function loadSpotifyStatus() {
  try {
    const s = await (await fetch('/api/spotify/status')).json();
    spConnected = !!s.connected;
    els.spDisconnected.classList.toggle('hidden', spConnected);
    els.spConnected.classList.toggle('hidden', !spConnected);
    els.spState.textContent = spConnected ? 'conectado' : (s.configured ? 'desconectado' : 'não configurado');
    els.spState.className = 'card-sub' + (spConnected ? ' on' : '');
    els.spNotConfigured.classList.toggle('hidden', s.configured);
    els.spConnect.disabled = !s.configured;

    if (spConnected && s.current) {
      const c = s.current;
      spPlaying = !!c.isPlaying;
      els.spTrack.textContent = c.track || 'nada tocando';
      els.spArtist.textContent = c.artist || '';
      if (c.imageUrl) els.spArt.src = c.imageUrl; else els.spArt.removeAttribute('src');
      els.spPlayPause.textContent = spPlaying ? '⏸' : '▶';
      if (c.volume != null) els.spVol.value = c.volume;
    }
  } catch { /* motor ocupado */ }
}

async function spotifyCmd(action, query) {
  const path = action === 'play' ? 'play' : action;
  try {
    const res = await fetch('/api/spotify/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query != null ? { query } : {}),
    });
    const data = await res.json();
    if (!data.ok) { showToast('🎵 Spotify', data.error || 'Falha no comando.', 'warn'); return; }
    setTimeout(loadSpotifyStatus, 600); // dá um tempo pro Spotify aplicar
  } catch {
    showToast('🎵 Spotify', 'Não consegui falar com o Spotify.', 'warn');
  }
}

async function spotifyVolume(percent) {
  try {
    await fetch('/api/spotify/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ percent }),
    });
  } catch { /* noop */ }
}

// ==================================================================
//  MODO JOGO — League of Legends ao vivo
// ==================================================================
function wireGames() {
  els.gamesBtn.addEventListener('click', toggleGameMode);
  els.gameClose.addEventListener('click', toggleGameMode);
  document.addEventListener('keydown', (e) => {
    // Esc sai do Modo Jogo (menos quando você está digitando).
    if (e.key === 'Escape' && gameMode && document.activeElement !== els.textInput) toggleGameMode();
  });
  els.lolCoachBtn.addEventListener('click', askCoach);
  els.lolBuildBtn.addEventListener('click', askBuild);
  els.lolReplay.addEventListener('click', repeatLastSpeech);
  els.lolStop.addEventListener('click', () => {
    Voice.cancelSpeak();
    markHistorySpeaking(null);
    Voice.resumeListening();
  });
}

function toggleGameMode() {
  gameMode = !gameMode;
  els.gamesBtn.classList.toggle('active', gameMode);
  els.gameDeck.classList.toggle('hidden', !gameMode);
  // A classe no body é quem tira os painéis normais de cena e dá a tela
  // inteira para o jogo.
  document.body.classList.toggle('game-mode', gameMode);

  if (gameMode) {
    spokenTips.clear();
    linhaDoTempo = [];
    loadLolHistory();
    pollLol();
    pollDesempenho();
    lolTimer = setInterval(pollLol, 4000);
    perfTimer = setInterval(pollDesempenho, 2000);
    showToast('🎮 Modo Jogo', 'Tela dedicada ao League of Legends.', '');
  } else {
    clearInterval(lolTimer);
    clearInterval(perfTimer);
    lolTimer = null;
    perfTimer = null;
  }
}

async function pollLol() {
  const wasInGame = lastLolState?.inGame === true;
  let s;
  try {
    s = await (await fetch('/api/lol/live')).json();
  } catch {
    s = { inGame: false };
  }
  renderLol(s);
  // Partida acabou (estava em jogo e agora não está) → retrospecto.
  if (wasInGame && !s.inGame) finishGame();
}

async function finishGame() {
  showToast('🏁 Fim de jogo', 'Gerando seu retrospecto da partida…', '');
  try {
    const res = await fetch('/api/lol/postgame', { method: 'POST' });
    if (!res.ok) return;
    const { report } = await res.json();
    if (report?.analysis) {
      await loadLolHistory();
      if (els.lolVoice.checked) {
        Voice.pauseListening();
        markHistorySpeaking(report.id);
        Voice.speak(report.analysis);
      }
      showToast(
        '🏁 Retrospecto pronto',
        report.result
          ? 'Veja a análise no Histórico de partidas.'
          : 'Não peguei o placar final — marque Vitória ou Derrota no histórico.',
        ''
      );
    }
  } catch { /* sem retrospecto desta vez */ }
}

function fmtObj(sec, upText = 'disponível') {
  if (sec == null) return { text: '—', up: false };
  if (sec <= 0) return { text: upText, up: true };
  const m = Math.floor(sec / 60), s = sec % 60;
  return { text: m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`, up: false };
}

function renderLol(s) {
  lastLolState = s;
  ultimoFps = s.performance || ultimoFps;
  if (!s.inGame) {
    els.lolOffline.classList.remove('hidden');
    els.lolLive.classList.add('hidden');
    els.gdMe.classList.add('hidden');
    els.lolClock.textContent = 'fora de partida';
    return;
  }
  els.lolOffline.classList.add('hidden');
  els.lolLive.classList.remove('hidden');
  els.gdMe.classList.remove('hidden');
  els.lolClock.textContent = `${s.clock} · ${s.mode}`;
  els.gdMode.textContent = s.isAram ? 'ARAM' : 'League of Legends';

  registrarPonto(s);
  renderGraficos(s);

  const a = s.active;
  if (a) {
    els.lolChamp.textContent = a.champion || '—';
    els.lolKda.textContent = `${a.kills} / ${a.deaths} / ${a.assists}`;
    els.lolLevel.textContent = a.level ?? '—';
    // No ARAM o CS por minuto não diz nada — mostra só o número puro.
    els.lolCs.textContent = s.isAram ? String(a.cs) : `${a.cs} (${a.csPerMin}/min)`;
    els.lolGold.textContent = a.gold;
    els.lolHp.textContent = a.hpPct != null ? `${a.hpPct}%` : '—';
    els.lolKp.textContent = s.score?.kp != null ? `${s.score.kp}%` : '—';
  }

  // TODO objetivo aparece como "seus × do inimigo". Antes vinha o total dos
  // dois times somado — o que fazia parecer que o time estava dominando.
  const o = s.objectives;
  const placar = (meus, deles) => (meus != null ? `${meus} × ${deles}` : '—');
  const drag = fmtObj(o.dragonIn);
  const bar = fmtObj(o.baronIn);

  els.lolDragon.textContent = `${placar(o.dragonsAlly, o.dragonsEnemy)}  ·  ${drag.text}`;
  els.lolDragon.className = drag.up ? 'up' : '';
  els.lolDragon.title = [
    o.dragonTypesAlly?.length ? `Seus: ${o.dragonTypesAlly.join(', ')}` : 'Você ainda não pegou dragão',
    o.dragonTypesEnemy?.length ? `Deles: ${o.dragonTypesEnemy.join(', ')}` : 'O inimigo não pegou dragão',
  ].join(' · ');

  els.lolBaron.textContent = `${placar(o.baronsAlly, o.baronsEnemy)}  ·  ${bar.text}`;
  els.lolBaron.className = bar.up ? 'up' : '';
  els.lolTowers.textContent = placar(o.towersAlly, o.towersEnemy);
  els.lolTowers.title = `Inibidores: ${placar(o.inhibsAlly, o.inhibsEnemy)}`;

  // Placar por LADO (você e inimigos), não por cor: "azul/vermelho" obrigava
  // a lembrar de que lado você estava jogando.
  const meuLado = s.active?.team === 'CHAOS' ? s.teams.chaos : s.teams.order;
  const outroLado = s.active?.team === 'CHAOS' ? s.teams.order : s.teams.chaos;
  els.lolOrder.textContent = `${meuLado.kills}/${meuLado.deaths}/${meuLado.assists}`;
  els.lolChaos.textContent = `${outroLado.kills}/${outroLado.deaths}/${outroLado.assists}`;

  // Radar do jungler inimigo (o mais perto de "aviso de gank" que é legítimo)
  const ejg = s.enemyJungler;
  if (ejg) {
    els.lolJungler.classList.remove('hidden');
    if (ejg.isDead) {
      els.lolJungler.className = 'lol-jungler safe';
      els.lolJungler.innerHTML = `🟢 Jungler inimigo <b>${escapeHtml(ejg.champion)}</b> morto (~${ejg.respawnIn}s). Seguro pra empurrar/objetivo.`;
    } else {
      els.lolJungler.className = 'lol-jungler danger';
      els.lolJungler.innerHTML = `🟡 Jungler inimigo <b>${escapeHtml(ejg.champion)}</b> vivo. Não sei onde ele está — cuidado ao empurrar sem visão.`;
    }
  } else {
    els.lolJungler.classList.add('hidden');
  }

  // Times detalhados (com rota, você, oponente, jungler, morto)
  els.lolAllies.innerHTML = s.allies.map((p) => playerRow(p, false)).join('');
  els.lolEnemies.innerHTML = s.enemies.map((p) => playerRow(p, true)).join('');

  // Dicas do treinador
  const tips = s.tips || [];
  if (!tips.length) {
    els.lolTips.innerHTML = '<li class="muted">Tudo sob controle. Siga o seu plano.</li>';
  } else {
    els.lolTips.innerHTML = tips
      .map((t) => `<li class="${t.level === 'urgent' ? 'urgent' : t.level === 'warn' ? 'warn' : ''}">${escapeHtml(t.text)}</li>`)
      .join('');
  }

  // Avisos por voz: fala no máximo uma dica importante e nova por ciclo.
  if (els.lolVoice.checked && !busy) {
    for (const t of tips) {
      if ((t.level === 'warn' || t.level === 'urgent') && !spokenTips.has(t.id)) {
        spokenTips.add(t.id);
        Voice.speak(t.text);
        break;
      }
    }
  }
}

// ==================================================================
//  GRÁFICOS DA PARTIDA
//  A Riot só entrega o instante atual. Guardamos cada leitura para poder
//  desenhar a evolução — é isso que mostra se o jogo está virando.
// ==================================================================
function registrarPonto(s) {
  const min = Math.round((s.gameTime || 0) / 60);
  const ultimo = linhaDoTempo[linhaDoTempo.length - 1];
  if (ultimo && ultimo.t === min) linhaDoTempo.pop(); // um ponto por minuto
  linhaDoTempo.push({
    t: min,
    abatesA: s.score?.allyKills ?? 0,
    abatesB: s.score?.enemyKills ?? 0,
    meuCs: s.active?.cs ?? 0,
    csDoRival: (s.enemies || []).find((p) => p.champion === s.opponent?.champion)?.cs ?? 0,
  });
  if (linhaDoTempo.length > 120) linhaDoTempo.shift();
}

function renderGraficos(s) {
  const o = s.objectives || {};
  const eu = (s.allies || []).find((p) => p.isMe);
  const maxKda = Math.max(
    1,
    ...[...(s.allies || []), ...(s.enemies || [])].map((p) => (p.kills || 0) + (p.assists || 0))
  );
  const ficha = (lista) =>
    (lista || []).map((p) => ({
      campeao: p.champion,
      valor: (p.kills || 0) + (p.assists || 0),
      isMe: !!p.isMe,
    }));

  const partes = [
    linhaDupla({
      titulo: 'Abates ao longo da partida',
      pontos: linhaDoTempo.map((p) => ({ t: p.t, a: p.abatesA, b: p.abatesB })),
      rotuloA: 'seu time',
      rotuloB: 'inimigos',
    }),
  ];

  // CS só faz sentido onde existe rota para farmar.
  if (!s.isAram && eu) {
    partes.push(
      linhaDupla({
        titulo: `CS: você × ${s.opponent?.champion || 'oponente'}`,
        pontos: linhaDoTempo.map((p) => ({ t: p.t, a: p.meuCs, b: p.csDoRival })),
        rotuloA: 'você',
        rotuloB: s.opponent?.champion || 'rival',
        altura: 100,
      })
    );
  }

  // Como você morreu — o gráfico que mostra se foi erro seu ou o jogo em cima.
  const m = s.mortes;
  if (m && m.total > 0) {
    partes.push(
      barrasJogadores({
        titulo: `Suas ${m.total} mortes — como aconteceram`,
        jogadores: [
          { campeao: 'Pego em número', valor: m.emNumero },
          { campeao: 'Em luta coletiva', valor: m.emLuta },
          { campeao: 'Duelo 1x1', valor: m.duelo },
        ],
        cor: '#ff7d8c',
        max: m.total,
      })
    );
  }

  partes.push(
    barrasComparadas({
      titulo: 'Objetivos · seu time × inimigos',
      itens: [
        { rotulo: 'Torres', a: o.towersAlly, b: o.towersEnemy },
        { rotulo: 'Dragões', a: o.dragonsAlly, b: o.dragonsEnemy },
        { rotulo: 'Barões', a: o.baronsAlly, b: o.baronsEnemy },
        { rotulo: 'Inibidores', a: o.inhibsAlly, b: o.inhibsEnemy },
      ],
    }),
    barrasJogadores({
      titulo: 'Participação em abates · seu time',
      jogadores: ficha(s.allies),
      cor: '#6aa8ff',
      max: maxKda,
    }),
    barrasJogadores({
      titulo: 'Participação em abates · inimigos',
      jogadores: ficha(s.enemies),
      cor: '#ff7d8c',
      max: maxKda,
    })
  );

  els.gdGraficos.innerHTML = partes.join('');
}

// ==================================================================
//  DESEMPENHO DO PC DENTRO DO JOGO (com FPS quando dá para medir)
// ==================================================================
async function pollDesempenho() {
  if (!gameMode) return;
  try {
    const m = await (await fetch('/api/metrics')).json();
    if (!m.error) renderDesempenho(m);
  } catch { /* tenta no próximo ciclo */ }
}

function renderDesempenho(m) {
  const gpu = m.gpu;
  const vramPct = gpu ? Math.round((gpu.memUsedMB / gpu.memTotalMB) * 100) : null;
  els.gdPerf.innerHTML = [
    medidor({
      rotulo: 'FPS',
      valor: ultimoFps?.fps != null ? Math.round(ultimoFps.fps) : null,
      unidade: '',
      // 144 como referência de tela: acima disso a rosca fica cheia.
      pct: ultimoFps?.fps != null ? (ultimoFps.fps / 144) * 100 : 0,
      cor: '#ffcf5a',
      nota: ultimoFps?.dica || 'Quadros por segundo do jogo, medidos pelo PresentMon.',
    }),
    medidor({ rotulo: 'CPU', valor: m.cpu?.usage ?? null, pct: m.cpu?.usage ?? 0, cor: '#3fe6ff', nota: m.cpu?.model || '' }),
    medidor({
      rotulo: 'GPU', valor: gpu?.util ?? null, pct: gpu?.util ?? 0, cor: '#b06bff',
      nota: gpu ? `${gpu.name} · ${gpu.temp}°C` : 'GPU não detectada',
    }),
    medidor({
      rotulo: 'VRAM', valor: vramPct, pct: vramPct ?? 0, cor: '#7d6bff',
      nota: gpu ? `${(gpu.memUsedMB / 1024).toFixed(1)} de ${(gpu.memTotalMB / 1024).toFixed(0)} GB` : '',
    }),
    medidor({ rotulo: 'RAM', valor: m.ram?.percent ?? null, pct: m.ram?.percent ?? 0, cor: '#66eaff', nota: `${m.ram?.usedGB} de ${m.ram?.totalGB} GB` }),
    medidor({
      rotulo: 'GPU °C', valor: gpu?.temp ?? null, unidade: '°',
      pct: gpu ? (gpu.temp / 90) * 100 : 0,
      cor: gpu && gpu.temp >= 80 ? '#ff5b8a' : '#ffb84d',
      nota: 'Temperatura da placa de vídeo',
    }),
  ].join('');

  // Explica o FPS "n/d" uma vez, sem poluir a tela toda hora.
  const semFps = !ultimoFps || ultimoFps.fps == null;
  els.gdFpsNota.classList.toggle('hidden', !semFps);
  if (semFps) {
    els.gdFpsNota.innerHTML = ultimoFps?.dica
      ? `ℹ️ ${escapeHtml(ultimoFps.dica)}`
      : 'ℹ️ O FPS aparece quando há partida em andamento.';
  }
}

async function loadLolHistory() {
  try {
    const list = await (await fetch('/api/lol/history')).json();
    lolHistory = Array.isArray(list) ? list : [];
    renderHistory();
  } catch { /* noop */ }
}

/** Resumo do histórico: vitórias, derrotas e as médias que importam. */
function historySummary(list) {
  const vit = list.filter((h) => h.result === 'Vitória').length;
  const der = list.filter((h) => h.result === 'Derrota').length;
  const decididas = vit + der;
  const num = (campo) => list.map((h) => h[campo]).filter((v) => typeof v === 'number');
  const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const k = media(num('kills')), d = media(num('deaths')), a = media(num('assists'));
  const kp = media(num('kp'));

  const partes = [];
  if (decididas) {
    const taxa = Math.round((vit / decididas) * 100);
    partes.push(`<span class="${taxa >= 50 ? 'win' : 'lose'}">Vitórias <b>${taxa}%</b> (${vit}V ${der}D)</span>`);
  }
  if (k != null && d != null && a != null) {
    partes.push(`<span>KDA médio <b>${k.toFixed(1)}/${d.toFixed(1)}/${a.toFixed(1)}</b></span>`);
  }
  if (kp != null) partes.push(`<span>Participação média <b>${Math.round(kp)}%</b></span>`);
  return partes.join('');
}

function renderHistory() {
  const list = lolHistory;
  els.lolHistCount.textContent = list.length;

  const resumo = list.length ? historySummary(list) : '';
  els.lolHistSummary.innerHTML = resumo;
  els.lolHistSummary.classList.toggle('hidden', !resumo);

  if (!list.length) {
    els.lolHistory.innerHTML = '<li class="muted">nenhuma partida registrada ainda</li>';
    return;
  }

  els.lolHistory.innerHTML = list.map(historyItemHtml).join('');
  for (const li of els.lolHistory.querySelectorAll('.lol-hist-item')) {
    const id = li.dataset.id;
    const item = list.find((h) => h.id === id);
    li.querySelector('.lh-speak')?.addEventListener('click', () => speakHistory(item));
    li.querySelector('.lh-again')?.addEventListener('click', (e) => reanalyzeHistory(item, e.currentTarget));
    li.querySelector('.lh-del')?.addEventListener('click', () => deleteHistoryItem(id));
    li.querySelector('.lh-win')?.addEventListener('click', () => markResult(item, 'Vitória'));
    li.querySelector('.lh-lose')?.addEventListener('click', () => markResult(item, 'Derrota'));
  }
}

function historyItemHtml(h) {
  const d = new Date(h.date).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const resCls = h.result === 'Vitória' ? 'win' : h.result === 'Derrota' ? 'lose' : 'unknown';
  const resTxt = h.result || 'resultado n/d';
  const falando = speakingHistoryId === h.id;

  // Fatos que a análise usa — deixar à vista é o que permite conferir se o
  // que o Shadow falou bate com a partida.
  // Só entram os números que existem dos DOIS lados: partidas antigas
  // guardavam o total somado dos times e mostrá-lo aqui enganaria de novo.
  const fatos = [];
  const duelo = (rot, meu, dele) =>
    meu != null && dele != null ? fatos.push(`<span>${rot} <b>${meu}</b> × ${dele}</span>`) : null;
  if (h.kp != null) fatos.push(`<span>participação <b>${h.kp}%</b></span>`);
  duelo('abates do time', h.teamKills, h.enemyKills);
  duelo('torres', h.towersAlly, h.towersEnemy);
  if (!h.isAram) duelo('dragões', h.dragons, h.dragonsEnemy);
  if (!h.isAram) duelo('barões', h.barons, h.baronsEnemy);

  const semCs = h.isAram || h.role === 'Suporte';
  const meta =
    `KDA ${escapeHtml(h.kda || '—')}` +
    (semCs ? '' : ` · CS ${h.cs ?? '—'} (${h.csPerMin ?? '—'}/min)`) +
    ` · ${escapeHtml(h.duration || '—')}` +
    (h.role ? ` · ${escapeHtml(h.role)}` : '');

  const marcar =
    h.result
      ? ''
      : `<span class="lh-ask">acabou como:</span>` +
        `<button class="lh-btn win lh-win" title="Marcar como vitória">Vitória</button>` +
        `<button class="lh-btn lose lh-lose" title="Marcar como derrota">Derrota</button>`;

  return (
    `<li class="lol-hist-item ${resCls === 'unknown' ? '' : resCls}" data-id="${h.id}">` +
    `<div class="lh-head"><b>${escapeHtml(h.champion || '—')}</b>` +
    `<span class="lh-res ${resCls}">${escapeHtml(resTxt)}</span>` +
    (h.mode ? `<span class="lh-mode">${escapeHtml(h.mode)}</span>` : '') +
    `<span class="lh-date">${d}</span></div>` +
    `<div class="lh-meta">${meta}</div>` +
    (fatos.length ? `<div class="lh-facts">${fatos.join('')}</div>` : '') +
    (h.numerosCorrigidos
      ? `<div class="lh-aviso">⚠️ Esta análise foi escrita com números de objetivos errados (um bug já corrigido). Refaça a análise para valer.</div>`
      : '') +
    `<div class="lh-analysis${falando ? ' speaking' : ''}">${escapeHtml(h.analysis || '')}</div>` +
    `<div class="lh-actions">` +
    `<button class="lh-btn lh-speak${falando ? ' speaking' : ''}" title="Ouvir a análise de novo">` +
    `${falando ? '⏹ Parar' : '🔊 Ouvir de novo'}</button>` +
    (h.snapshot ? `<button class="lh-btn lh-again" title="Gerar outra análise com os mesmos números">♻️ Refazer análise</button>` : '') +
    marcar +
    `<button class="lh-btn del lh-del" title="Excluir">✕</button>` +
    `</div></li>`
  );
}

/** Lê (ou para de ler) a análise de uma partida. */
function speakHistory(h) {
  if (!h) return;
  if (speakingHistoryId === h.id) {
    Voice.cancelSpeak();
    markHistorySpeaking(null);
    Voice.resumeListening();
    return;
  }
  if (!h.analysis) {
    showToast('🎮 Sem análise', 'Essa partida não tem retrospecto salvo.', 'warn');
    return;
  }
  Voice.pauseListening();
  markHistorySpeaking(h.id);
  Voice.speak(h.analysis);
}

function markHistorySpeaking(id) {
  if (speakingHistoryId === id) return;
  speakingHistoryId = id;
  if (gameMode && lolHistory.length) renderHistory();
}

async function reanalyzeHistory(h, btn) {
  if (!h) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Analisando…';
  try {
    const res = await fetch(`/api/lol/history/${h.id}/reanalyze`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao refazer.');
    Object.assign(h, data);
    renderHistory();
    if (els.lolVoice.checked) {
      Voice.pauseListening();
      markHistorySpeaking(h.id);
      Voice.speak(data.analysis);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original;
    showToast('⚠️ Erro', err.message || 'Não consegui refazer a análise.', 'warn');
  }
}

/** Marca vitória/derrota à mão e refaz a análise já sabendo o resultado. */
async function markResult(h, result) {
  if (!h) return;
  try {
    const res = await fetch('/api/lol/history/' + h.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao marcar.');
    Object.assign(h, data);
    renderHistory();
    showToast(
      result === 'Vitória' ? '🏆 Vitória anotada' : '📉 Derrota anotada',
      'Se quiser, use "Refazer análise" para o retrospecto considerar o resultado.',
      ''
    );
  } catch (err) {
    showToast('⚠️ Erro', err.message || 'Não consegui marcar o resultado.', 'warn');
  }
}

async function deleteHistoryItem(id) {
  try {
    await fetch('/api/lol/history/' + id, { method: 'DELETE' });
    loadLolHistory();
  } catch { /* noop */ }
}

function playerRow(p, isEnemy) {
  const opp = lastLolState?.opponent;
  const isOpp = isEnemy && opp && p.champion === opp.champion && p.role === opp.role;
  const cls = ['', p.isMe ? 'me' : '', isOpp ? 'opp' : '', p.isDead ? 'dead' : ''].join(' ').trim();
  const tags = [];
  if (p.isMe) tags.push('⭐');
  if (isOpp) tags.push('⚔️');
  if (p.isJungler) tags.push('🌲');
  if (p.isDead) tags.push(`💀${p.respawnIn}s`);

  // KDA e CS de cada um: sem isto dava para ver quem estava na partida, mas
  // não como ela estava indo.
  const kda = `${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}`;
  const semCs = lastLolState?.isAram;
  return (
    `<li class="${cls}" title="${escapeHtml(p.name || p.champion)}">` +
    `<span class="lt-role">${escapeHtml(p.role || '—')}</span>` +
    `<span class="lt-champ">${escapeHtml(p.champion)}</span>` +
    `<span class="lt-kda">${kda}</span>` +
    (semCs ? '' : `<span class="lt-cs">${p.cs ?? 0} cs</span>`) +
    `<span class="lt-tag">${tags.join(' ')}</span>` +
    `</li>`
  );
}

async function askBuild() {
  if (!lastLolState || !lastLolState.inGame) {
    showToast('🎮 Sem partida', 'Entre em uma partida para pedir a build.', 'warn');
    return;
  }
  const btn = els.lolBuildBtn;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Montando…';
  try {
    const res = await fetch('/api/lol/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: lastLolState }),
    });
    const data = await res.json();
    const advice = data.advice || data.error || 'Sem recomendação agora.';
    els.lolTips.insertAdjacentHTML('afterbegin', `<li class="urgent">🛡️ ${escapeHtml(advice)}</li>`);
    if (els.lolVoice.checked) Voice.speak(advice);
  } catch {
    showToast('⚠️ Erro', 'Não consegui montar a build agora.', 'warn');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function askCoach() {
  if (!lastLolState || !lastLolState.inGame) {
    showToast('🎮 Sem partida', 'Entre em uma partida para pedir a dica.', 'warn');
    return;
  }
  els.lolCoachBtn.disabled = true;
  const original = els.lolCoachBtn.textContent;
  els.lolCoachBtn.textContent = 'Pensando…';
  try {
    const res = await fetch('/api/lol/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: lastLolState }),
    });
    const data = await res.json();
    const tip = data.tip || data.error || 'Sem dica agora.';
    els.lolTips.insertAdjacentHTML('afterbegin', `<li class="urgent">💡 ${escapeHtml(tip)}</li>`);
    if (els.lolVoice.checked) Voice.speak(tip);
  } catch {
    showToast('⚠️ Erro', 'Não consegui pedir a dica agora.', 'warn');
  } finally {
    els.lolCoachBtn.disabled = false;
    els.lolCoachBtn.textContent = original;
  }
}
