import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// manter primeiro entre os imports locais: carrega o .env antes de qualquer
// outro módulo ler process.env (nenhum organizador de import deve reordenar isto)
import { config, hasApiKey, CATCHPHRASE, ENV_PATH, isPackagedApp, saveApiKey } from './config.js';
import { processMessage, resetConversation, resetAI, modeloAtivo } from './brain.js';
import { synthesize, warmUp, isBlocked, VOICES, isLocalAvailable, resetTtsAI } from './tts.js';
import { transcribe, resetSttAI } from './stt.js';
import { warmUpLocal, shutdownLocal } from './tts-local.js';
import {
  loadReminders,
  startReminderLoop,
  reminderEvents,
  listReminders,
} from './tools/reminders.js';
import { getMetrics } from './tools/metrics.js';
import { getWeather } from './tools/weather.js';
import { getLolLive, getLastInGame, clearLastInGame, getLolDebug } from './tools/lol.js';
import { lolCoach, lolBuildAdvice, lolPostGame, lolReanalyze, lolMatchPayload } from './brain.js';
import {
  loadHistory,
  listHistory,
  addHistory,
  deleteHistory,
  getHistory,
  updateHistory,
} from './tools/lol-history.js';
import { startupStatus, setStartup } from './tools/startup.js';
import { getFps, iniciarFps, pararFps, fpsDisponivel } from './tools/fps.js';
import {
  loadSpotify,
  getAuthUrl,
  exchangeCode,
  status as spotifyStatus,
  play as spotifyPlay,
  pause as spotifyPause,
  next as spotifyNext,
  previous as spotifyPrevious,
  setVolume as spotifySetVolume,
} from './tools/spotify.js';
import { hasSpotify } from './config.js';
import {
  loadCommands,
  listCommands,
  addCommand,
  updateCommand,
  deleteCommand,
  markRun,
} from './tools/commands.js';
import { initDb } from './db/index.js';
import { communityRouter } from './api/community.js';
import { login, requireAuth, seedEmployeesIfEmpty, type AuthedRequest } from './office/auth.js';
import { attachOfficeSocket } from './office/socket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const ROOT_DIR = join(__dirname, '..', '..', '..');

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Abre a janela do app assim que o motor comeca a escutar. Como isto roda
// dentro do callback do listen(), a porta ja esta no ar: nada de esperar
// por tempo nem cair na tela de "localhost recusou a conexao".
// So dispara quando iniciado pelo Shadow.bat (SHADOW_LAUNCH=1), para o
// `npm start`/dev nao ficar abrindo navegador sozinho.
function openAppWindow(): void {
  if (process.platform !== 'win32') return;
  if (process.env.SHADOW_LAUNCH !== '1') return;
  try {
    const child = spawn('cmd', ['/c', join(ROOT_DIR, 'abrir-janela.bat')], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    console.error('[janela]', errMsg(err));
  }
}

const app = express();
app.use(express.json());

// ---- Roteamento da plataforma (antes do estático) ----
// A raiz "/" agora é o escritório 2D — substitui de vez o shell das Salas
// (React, canais fixos). O bundle antigo continua no ar em /salas-legado
// como rede de segurança enquanto valida o corte; sai de vez depois.
const OFFICE = join(PUBLIC_DIR, 'office', 'index.html');
app.get('/', (req, res) => res.sendFile(OFFICE));
app.get('/office', (req, res) => res.sendFile(OFFICE));
app.get('/salas-legado', (req, res) => res.sendFile(join(PUBLIC_DIR, 'salas', 'index.html')));
// O app do assistente (voz, LoL, monitor) continua inteiro — servido em
// /assistant e embutido como janela flutuante dentro do escritório (iframe,
// mesmo domínio). Servido SEM barra final para os caminhos relativos
// (css/, js/) resolverem a partir da raiz.
app.get('/assistant', (req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

app.use(express.static(PUBLIC_DIR));

// API da plataforma "Salas" (comunidade estilo Discord).
app.use('/api/community', communityRouter);

// ---- Escritório 2D: login dos funcionários ----
app.post('/api/office/login', async (req, res) => {
  try {
    const { token, employee } = await login(req.body?.username, req.body?.password);
    res.json({ token, employee });
  } catch (err) {
    res.status(401).json({ error: errMsg(err) || 'Usuário ou senha inválidos.' });
  }
});

// Confirma quem é o dono de um token — usado pelo cliente pra validar a
// sessão salva antes de tentar entrar direto no mapa.
app.get('/api/office/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ employee: req.employee });
});

// Estado / configuração da interface.
app.get('/api/status', (req, res) => {
  res.json({
    ready: hasApiKey(),
    model: modeloAtivo(), // pode ser o reserva, se o principal esgotou o dia
    userName: config.userName,
    assistantName: config.assistantName,
    reminders: listReminders().length,
    catchphrase: CATCHPHRASE,
    envPath: ENV_PATH,
    isApp: isPackagedApp,
    tts: {
      local: isLocalAvailable(),
      gemini: config.ttsEnabled && hasApiKey(),
      engine: config.defaultEngine,
      voice: config.ttsVoice,
      voices: VOICES,
    },
  });
});

// Voz neural: devolve um WAV pronto para tocar.
// Se falhar (sem chave / sem internet / cota), responde 503 e a interface
// cai automaticamente na voz do navegador.
app.post('/api/tts', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const voice = String(req.body?.voice || '') || config.ttsVoice;
  const engine = req.body?.engine === 'gemini' ? 'gemini' : 'local';
  if (!text) return res.status(400).json({ error: 'Texto vazio.' });

  if (engine === 'local' && !isLocalAvailable()) {
    return res.status(503).json({ error: 'Voz local não instalada.' });
  }
  if (engine === 'gemini') {
    if (!config.ttsEnabled || !hasApiKey()) {
      return res.status(503).json({ error: 'Voz do Gemini indisponível.' });
    }
    if (isBlocked()) {
      return res.status(503).json({ error: 'Cota de voz em espera.', quota: true });
    }
  }

  try {
    const wav = await synthesize(text, { engine, voice });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.send(wav);
  } catch (err) {
    const quota = !!(err as any)?.quota;
    if (!quota) console.error('[tts]', errMsg(err));
    res.status(503).json({ error: errMsg(err) || 'Falha na síntese.', quota });
  }
});

// Transcrição de voz — o microfone do modo aplicativo depende disto.
// Recebe o áudio cru (o front manda como audio/webm) e devolve o texto.
app.post(
  '/api/stt',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '12mb' }),
  async (req, res) => {
    if (!hasApiKey()) return res.status(503).json({ error: 'Sem chave da API.' });
    try {
      const { text, calledByName } = await transcribe(
        req.body,
        req.headers['content-type'] || 'audio/webm'
      );
      res.json({ text, calledByName });
    } catch (err) {
      console.error('[stt]', errMsg(err));
      res.status(503).json({ error: errMsg(err) || 'Falha ao transcrever.' });
    }
  }
);

// Salva a chave da API pela própria interface e passa a valer na hora.
app.post('/api/apikey', async (req, res) => {
  try {
    const caminho = await saveApiKey(req.body?.key);
    resetAI();
    resetTtsAI();
    resetSttAI();
    console.log(`  ⚡  Chave da API configurada em ${caminho}`);
    res.json({ ok: true, ready: hasApiKey(), path: caminho });
  } catch (err) {
    res.status(400).json({ error: errMsg(err) || 'Não consegui salvar a chave.' });
  }
});

// Reinicia a conversa (memória).
app.post('/api/reset', (req, res) => {
  resetConversation();
  res.json({ ok: true });
});

// Lista os lembretes ativos (para o painel lateral).
app.get('/api/reminders', (req, res) => {
  res.json(listReminders());
});

// Conversa principal — responde em NDJSON (uma linha JSON por evento).
app.post('/api/chat', async (req, res) => {
  const userText = String(req.body?.text || '').trim();
  if (!userText) return res.status(400).json({ error: 'Mensagem vazia.' });

  if (!hasApiKey()) {
    return res.status(503).json({
      error:
        'Chave da API não configurada. Coloque sua GEMINI_API_KEY no arquivo .env.',
    });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  const send = (obj: Record<string, unknown>) => {
    try {
      res.write(JSON.stringify(obj) + '\n');
    } catch {
      /* conexão fechada */
    }
  };

  try {
    const { reply, actions } = await processMessage(userText, send);
    send({ type: 'final', text: reply, actions });
  } catch (err) {
    console.error('[chat] erro:', errMsg(err));
    send({
      type: 'error',
      text: 'Tive um problema para processar isso agora. Tente de novo daqui a pouco.',
    });
  } finally {
    res.end();
  }
});

// Monitor do sistema: CPU, RAM, GPU, temperatura, disco, bateria, uptime.
app.get('/api/metrics', async (req, res) => {
  try {
    res.json(await getMetrics());
  } catch (err) {
    res.status(503).json({ error: errMsg(err) || 'Falha ao ler o sistema.' });
  }
});

// Clima: usa as coordenadas do navegador se vierem; senao, IP.
app.get('/api/weather', async (req, res) => {
  const lat = req.query.lat != null ? Number(req.query.lat) : undefined;
  const lon = req.query.lon != null ? Number(req.query.lon) : undefined;
  try {
    res.json(await getWeather({ lat, lon }));
  } catch (err) {
    res.status(503).json({ error: errMsg(err) || 'Clima indisponível.' });
  }
});

// Modo Jogo — League of Legends ao vivo (Live Client Data API da Riot).
app.get('/api/lol/live', async (req, res) => {
  try {
    const estado = await getLolLive();
    // O FPS só é medido enquanto há partida: nada de processo rodando à toa.
    if (estado.inGame) iniciarFps(); else pararFps();
    res.json({ ...estado, performance: estado.inGame ? getFps() : null });
  } catch {
    res.json({ inGame: false });
  }
});

// Estado do medidor de FPS (para a tela explicar quando estiver indisponível).
app.get('/api/fps', (req, res) => {
  res.json({ ...getFps(), disponivel: fpsDisponivel() });
});

// Dica avançada gerada pelo Gemini a partir do estado enviado pela interface.
app.post('/api/lol/coach', async (req, res) => {
  try {
    const tip = await lolCoach(req.body?.state || {});
    res.json({ tip });
  } catch (err) {
    res.status(503).json({ error: errMsg(err) || 'Falha ao gerar a dica.' });
  }
});

// Recomendação de build/counter contra o time inimigo.
app.post('/api/lol/build', async (req, res) => {
  try {
    const advice = await lolBuildAdvice(req.body?.state || {});
    res.json({ advice });
  } catch (err) {
    res.status(503).json({ error: errMsg(err) || 'Falha ao montar a build.' });
  }
});

// Retrospecto pós-jogo: gera a análise a partir do último estado da partida
// e salva no histórico. Disparado pela interface quando a partida termina.
app.post('/api/lol/postgame', async (req, res) => {
  const state = getLastInGame();
  if (!state?.inGame || !state.active) return res.status(404).json({ error: 'Sem dados da última partida.' });
  try {
    const analysis = await lolPostGame(state);
    const a = state.active;
    const o = state.objectives || ({} as typeof state.objectives);
    const entry = await addHistory({
      champion: a.champion,
      role: state.myRole || state.opponent?.role || '',
      mode: state.mode || '',
      isAram: !!state.isAram,
      result: state.result || null,
      duration: state.clock,
      kda: `${a.kills}/${a.deaths}/${a.assists}`,
      kills: a.kills, deaths: a.deaths, assists: a.assists,
      level: a.level,
      cs: a.cs,
      csPerMin: a.csPerMin,
      gold: a.gold,
      kp: state.score?.kp ?? null,
      mortes: state.mortes || null, // como cada morte aconteceu
      teamKills: state.score?.allyKills ?? null,
      enemyKills: state.score?.enemyKills ?? null,
      towersAlly: o.towersAlly ?? null,
      towersEnemy: o.towersEnemy ?? null,
      dragons: o.dragonsAlly ?? 0,
      dragonsEnemy: o.dragonsEnemy ?? 0,
      barons: o.baronsAlly ?? 0,
      baronsEnemy: o.baronsEnemy ?? 0,
      items: a.items || [],
      allies: (state.allies || []).map((e) => e.champion),
      enemies: (state.enemies || []).map((e) => e.champion),
      opponent: state.opponent?.champion || null,
      // Guardado para poder refazer a análise depois sem a partida existir mais.
      snapshot: lolMatchPayload(state),
      analysis,
    });
    clearLastInGame(); // evita gerar o mesmo retrospecto duas vezes
    res.json({ report: entry });
  } catch (err) {
    res.status(503).json({ error: errMsg(err) || 'Falha ao gerar o retrospecto.' });
  }
});

// Eventos crus da partida + como cada estrutura foi atribuída. Existe para
// conferir a conta de torres com dados reais, em vez de no chute.
app.get('/api/lol/debug', (req, res) => {
  res.json(getLolDebug());
});

// Histórico de partidas.
app.get('/api/lol/history', (req, res) => {
  res.json(listHistory());
});

// Corrige o resultado à mão: quando o jogo fecha antes do último ciclo de
// leitura, a Riot já cortou a API e a partida fica como "resultado n/d".
app.patch('/api/lol/history/:id', async (req, res) => {
  const r = req.body?.result;
  const valido = r === 'Vitória' || r === 'Derrota' || r === null;
  if (!valido) return res.status(400).json({ error: 'Resultado inválido.' });
  const entry = await updateHistory(req.params.id!, { result: r });
  if (!entry) return res.status(404).json({ error: 'Partida não encontrada.' });
  res.json(entry);
});

// Refaz o retrospecto a partir dos números guardados (útil depois de marcar
// vitória/derrota, ou quando a análise anterior saiu ruim).
app.post('/api/lol/history/:id/reanalyze', async (req, res) => {
  const entry = getHistory(req.params.id!);
  if (!entry) return res.status(404).json({ error: 'Partida não encontrada.' });
  if (!entry.snapshot) {
    return res.status(400).json({ error: 'Esta partida é antiga e não guardou os números para reanálise.' });
  }
  try {
    const analysis = await lolReanalyze({ ...(entry.snapshot as object), resultado: entry.result || 'desconhecido' });
    const salvo = await updateHistory(entry.id, { analysis });
    res.json(salvo);
  } catch (err) {
    res.status(503).json({ error: errMsg(err) || 'Falha ao refazer a análise.' });
  }
});

app.delete('/api/lol/history/:id', async (req, res) => {
  res.json({ ok: await deleteHistory(req.params.id!) });
});

// ---- Iniciar com o Windows ----
app.get('/api/startup', async (req, res) => {
  res.json(await startupStatus());
});
app.post('/api/startup', async (req, res) => {
  try {
    res.json(await setStartup(!!req.body?.enabled));
  } catch (err) {
    res.status(500).json({ error: errMsg(err) || 'Falha ao configurar a inicialização.' });
  }
});

// ---- Spotify (API oficial) ----
// Inicia o login: redireciona o navegador para a tela de autorização da Spotify.
app.get('/api/spotify/login', (req, res) => {
  if (!hasSpotify()) {
    return res
      .status(400)
      .send('Configure SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET no arquivo .env e reinicie.');
  }
  const state = Math.random().toString(36).slice(2);
  res.redirect(getAuthUrl(state));
});

// Retorno do login: troca o código por tokens e mostra uma página de sucesso.
app.get('/api/spotify/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Sem código de autorização.');
  try {
    await exchangeCode(String(code));
    res.send(
      '<html><head><meta charset="utf-8"><title>Spotify conectado</title></head>' +
      '<body style="background:#0a0410;color:#efe7ff;font-family:sans-serif;text-align:center;padding-top:80px">' +
      '<h2>✅ Spotify conectado ao Shadow!</h2><p>Pode fechar esta aba e voltar para o Shadow.</p>' +
      '</body></html>'
    );
  } catch (err) {
    res.status(500).send('Falha ao conectar o Spotify: ' + (errMsg(err) || 'erro'));
  }
});

app.get('/api/spotify/status', async (req, res) => {
  try { res.json(await spotifyStatus()); }
  catch (err) { res.json({ configured: hasSpotify(), connected: false, error: errMsg(err) }); }
});

// Controles de reprodução. Erros viram mensagem humana (ex.: sem dispositivo).
const spotifyAction = (fn: (req: Request) => Promise<string>) => async (req: Request, res: Response) => {
  try {
    const msg = await fn(req);
    res.json({ ok: true, message: msg });
  } catch (err) {
    res.status(400).json({ ok: false, error: errMsg(err) || 'Falha no Spotify.' });
  }
};
app.post('/api/spotify/play', spotifyAction((req) => spotifyPlay(req.body?.query || '')));
app.post('/api/spotify/pause', spotifyAction(() => spotifyPause()));
app.post('/api/spotify/next', spotifyAction(() => spotifyNext()));
app.post('/api/spotify/previous', spotifyAction(() => spotifyPrevious()));
app.post('/api/spotify/volume', spotifyAction((req) => spotifySetVolume(req.body?.percent)));

// Comandos salvos (atalhos do usuario).
app.get('/api/commands', (req, res) => {
  res.json(listCommands());
});

app.post('/api/commands', async (req, res) => {
  try {
    const cmd = await addCommand(req.body?.trigger, req.body?.action);
    res.json(cmd);
  } catch (err) {
    res.status(400).json({ error: errMsg(err) || 'Não consegui salvar.' });
  }
});

app.put('/api/commands/:id', async (req, res) => {
  const cmd = await updateCommand(req.params.id!, req.body || {});
  if (!cmd) return res.status(404).json({ error: 'Comando não encontrado.' });
  res.json(cmd);
});

app.delete('/api/commands/:id', async (req, res) => {
  const ok = await deleteCommand(req.params.id!);
  res.json({ ok });
});

// Registra que um comando salvo foi disparado (contador de uso).
app.post('/api/commands/:id/run', async (req, res) => {
  const cmd = await markRun(req.params.id!);
  res.json(cmd || { ok: false });
});

// Fluxo de eventos do servidor (lembretes vencidos) via SSE.
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(': conectado\n\n');

  const onReminder = (reminder: unknown) => {
    res.write(`event: reminder\ndata: ${JSON.stringify(reminder)}\n\n`);
  };
  reminderEvents.on('reminder', onReminder);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    reminderEvents.off('reminder', onReminder);
  });
});

/**
 * No aplicativo instalado, garante que exista um .env em %APPDATA%\Shadow para
 * o usuário colar a chave — senão ele abre o app e não tem onde escrever.
 */
async function garantirEnvDoApp(): Promise<void> {
  if (!isPackagedApp || hasApiKey() || existsSync(ENV_PATH)) return;
  try {
    await mkdir(dirname(ENV_PATH), { recursive: true });
    const exemplo = join(ROOT_DIR, '.env.example');
    await copyFile(exemplo, ENV_PATH);
    console.log(`     Crie sua chave e cole em: ${ENV_PATH}`);
  } catch (err) {
    console.error('[env]', errMsg(err));
  }
}

const httpServer = createServer(app);
// A sinalização das Salas (/ws, biblioteca `ws` crua) foi DESLIGADA de
// propósito: coexistindo com o Socket.io do escritório no mesmo httpServer,
// os dois brigavam pelo upgrade de WebSocket (confirmado testando os dois
// juntos vs. só o socket.io — o erro "Unexpected response code: 400" some
// sem o /ws). Como o escritório 2D substitui as Salas por completo, não faz
// sentido reativar algo que já vai sair — `attachSignaling` fica sem uso
// aqui (arquivo mantido em realtime/signaling.ts só de referência por ora).
// Posição + proximidade do escritório 2D (Socket.io, path /socket.io).
attachOfficeSocket(httpServer);

async function start(): Promise<void> {
  await garantirEnvDoApp();
  await initDb();
  // Conta inicial do escritório 2D, só na primeira vez (banco vazio). Vem do
  // .env pra nunca ter senha em texto puro no código-fonte.
  if (process.env.OFFICE_SEED_USERNAME && process.env.OFFICE_SEED_PASSWORD) {
    await seedEmployeesIfEmpty([
      {
        username: process.env.OFFICE_SEED_USERNAME,
        name: process.env.OFFICE_SEED_NAME || process.env.OFFICE_SEED_USERNAME,
        password: process.env.OFFICE_SEED_PASSWORD,
      },
    ]);
  }
  await loadReminders();
  await loadCommands();
  await loadHistory();
  await loadSpotify();
  startReminderLoop();
  httpServer.listen(config.port, () => {
    openAppWindow();
    console.log(`\n  ⚡  ${config.assistantName.toUpperCase()} online`);
    console.log(`     Motor local: http://localhost:${config.port}`);
    console.log(`     Salas (equipe): http://localhost:${config.port}/salas`);
    console.log(`     Modelo: ${config.model}`);
    if (isLocalAvailable()) {
      console.log(`     Voz local: ${config.localVoice} (Piper, rápida e offline)`);
      warmUpLocal(); // carrega o modelo já, para a 1a fala não esperar
      warmUp(CATCHPHRASE, { engine: 'local' }); // bordão sai instantâneo
    } else {
      console.log('     Voz local: não instalada (veja a pasta voz-local)');
    }
    if (config.ttsEnabled && hasApiKey()) {
      console.log(`     Voz Gemini: ${config.ttsVoice} (máxima qualidade, mais lenta)`);
    }
    if (!hasApiKey()) {
      console.log(
        '\n  ⚠  Nenhuma GEMINI_API_KEY encontrada. A interface abre,\n' +
          `     mas o ${config.assistantName} só conversa depois que você preencher o .env.\n`
      );
    }
    console.log('');
  });
}

// Não deixa o processo do Piper órfão quando o motor é desligado.
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sinal, async () => {
    await shutdownLocal();
    process.exit(0);
  });
}
process.on('exit', () => { shutdownLocal(); });

start();
