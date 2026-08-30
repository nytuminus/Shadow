// Voz do Shadow: escuta CONTÍNUA (mic sempre aberto) + fala + nível de áudio.
// O app decide, a cada frase ouvida, se você chamou pelo nome ("Shadow").
//
// A FALA tem dois motores, nesta ordem:
//   1. NEURAL  — áudio gerado pelo Gemini no servidor (/api/tts). Voz humana,
//                com entonação de verdade. É o padrão.
//   2. NAVEGADOR — Web Speech API. Instantâneo, mas usa as vozes do Windows,
//                que soam sintéticas. Serve de rede de segurança quando o
//                neural falha (sem internet, cota estourada, sem chave).

const LS = {
  engine: 'shadow.voice.engine',       // 'neural' | 'browser'
  neural: 'shadow.voice.neural',       // nome da voz do Gemini
  browser: 'shadow.voice.browser',     // nome da voz do navegador
  volume: 'shadow.voice.volume',       // 0 a 1
};

// Ajuste da voz do NAVEGADOR (só o motor de reserva).
// Pitch 1.0 = tom natural. Baixar o pitch é o que deixava a voz com cara de robô.
const BROWSER_PITCH = 1.0;
const BROWSER_RATE = 1.02;

// Ritmo da escuta por gravação (modo aplicativo). Cada milissegundo aqui é
// tempo que você espera depois de terminar de falar.
const SILENCIO_MS = 650;   // quanto de silêncio fecha a sua frase
const MAX_FALA_MS = 12000; // teto de uma frase só
const OCIOSO_MS = 2000;    // reinicia a gravação parada, para não gravar silêncio à toa

export const Voice = {
  recognition: null,
  supported: false,
  active: false,   // escuta contínua ligada
  running: false,  // reconhecimento realmente rodando
  paused: false,   // pausado temporariamente (durante processar/falar)
  mode: 'off',     // off | listen | think | speak
  ptVoice: null,

  // Configuração dos motores do servidor (vem via /api/status).
  neural: { local: false, gemini: false, voice: 'Charon', voices: [] },
  engine: localStorage.getItem(LS.engine) || 'local',
  lastEngineUsed: null,

  // Volume da fala (0 a 1). Vale para os três motores.
  volume: readVolume(),
  muted: false,

  _restartTimer: null,
  _speakToken: 0,
  _audio: null,
  _outCtx: null,
  _outAnalyser: null,
  _outData: null,
  _outSrc: null,

  // callbacks (definidos pelo app)
  onPhrase: () => {},
  onListenStart: () => {},
  onListenStop: () => {},
  onSynthStart: () => {},
  onSpeakStart: () => {},
  onSpeakEnd: () => {},
  onError: () => {},
  onLevel: () => {},
  onActiveChange: () => {},
  onEngineUsed: () => {},
  onVolumeChange: () => {},
  onSttThinking: () => {},     // transcrevendo o que você falou
  onListenerChange: () => {},  // trocou o motor de escuta
  onCapture: () => {},         // começou/parou de capturar a sua fala

  init() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Dentro do aplicativo (Electron), a Web Speech API existe mas sempre
    // falha com "network" — o Electron não tem a chave do serviço de voz do
    // Google. Lá o Shadow já começa gravando e mandando transcrever.
    this.useStt = !!window.shadowDesktop;
    if (this.useStt) {
      this.supported = !!(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
      this.listener = 'servidor';
      this._loadVoices();
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
      }
      this._startLevelLoop();
      return;
    }
    this.listener = 'navegador';

    if (SR) {
      this.supported = true;
      const rec = new SR();
      rec.lang = 'pt-BR';
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        this.running = true;
        this.onListenStart();
      };
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const text = (r[0]?.transcript || '').trim();
            if (text) this.onPhrase(text);
          }
        }
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.active = false;
          this.mode = 'off';
          this.onError(e.error);
          this.onActiveChange(false);
          return;
        }
        // "network" = o serviço de voz do Google não respondeu. Se insistir,
        // passamos a gravar e transcrever pelo Gemini em vez de ficar mudo.
        if (e.error === 'network') {
          this._netFails = (this._netFails || 0) + 1;
          if (this._netFails >= 2) this.switchToStt();
          return;
        }
        // demais erros ('no-speech', 'aborted'): o onend cuida do restart
      };
      rec.onend = () => {
        this.running = false;
        this.onListenStop();
        if (this.active && !this.paused) this._scheduleRestart();
      };
      this.recognition = rec;
    }

    this._loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
    }
    this._startLevelLoop();
  },

  /** Recebe do servidor quais motores de voz estão disponíveis. */
  configureNeural(info) {
    if (!info) return;
    this.neural = {
      local: !!info.local,
      gemini: !!info.gemini,
      voice: localStorage.getItem(LS.neural) || info.voice || 'Charon',
      voices: info.voices || [],
    };
    if (!localStorage.getItem(LS.engine) && info.engine) this.engine = info.engine;
    // Se o motor guardado não existe mais, escolhe o melhor disponível.
    if (!this.engineAvailable(this.engine)) {
      this.engine = this.neural.local ? 'local' : this.neural.gemini ? 'gemini' : 'browser';
    }
  },

  engineAvailable(engine) {
    if (engine === 'local') return this.neural.local;
    if (engine === 'gemini') return this.neural.gemini;
    return true; // navegador sempre existe
  },

  setEngine(engine) {
    this.engine = ['local', 'gemini', 'browser'].includes(engine) ? engine : 'local';
    localStorage.setItem(LS.engine, this.engine);
  },
  setNeuralVoice(name) {
    this.neural.voice = name;
    localStorage.setItem(LS.neural, name);
  },
  setBrowserVoice(name) {
    localStorage.setItem(LS.browser, name);
    this._loadVoices();
  },

  /**
   * Ajusta o volume da fala (0 a 1). Se já estiver falando, muda na hora —
   * dá pra abaixar o Shadow no meio de uma frase.
   */
  setVolume(v) {
    const vol = Math.max(0, Math.min(1, Number(v) || 0));
    this.volume = vol;
    this.muted = vol === 0;
    localStorage.setItem(LS.volume, String(vol));
    if (this._audio) this._audio.volume = vol;
    // A voz do navegador não muda no meio da frase: o volume vale da próxima.
    this.onVolumeChange(vol);
    return vol;
  },

  /** Silencia / devolve o volume anterior. */
  toggleMute() {
    if (this.volume > 0) {
      this._volumeAntes = this.volume;
      this.setVolume(0);
    } else {
      this.setVolume(this._volumeAntes || 0.8);
    }
    return this.volume;
  },

  // ---------- Escuta ----------

  _scheduleRestart() {
    clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(() => this._safeStart(), 250);
  },
  _safeStart() {
    if (!this.recognition || this.running || !this.active || this.paused) return;
    try {
      this.recognition.start();
    } catch {
      /* já iniciado */
    }
  },

  async start() {
    if (!this.supported) return;
    await this.ensureAnalyser();
    this._unlockAudio();
    this.active = true;
    this.paused = false;
    this.mode = 'listen';
    this.onActiveChange(true);
    if (this.useStt) this._sttStart();
    else this._safeStart();
  },

  stop() {
    this.active = false;
    this.paused = false;
    this.mode = 'off';
    clearTimeout(this._restartTimer);
    this.cancelSpeak();
    this._sttStop();
    if (this.recognition && this.running) {
      try { this.recognition.stop(); } catch { /* noop */ }
    }
    this.onActiveChange(false);
  },

  toggle() {
    if (this.active) this.stop();
    else this.start();
  },

  /** Troca a escuta do navegador pela gravação + transcrição do Gemini. */
  switchToStt() {
    if (this.useStt) return;
    this.useStt = true;
    this.listener = 'servidor';
    this.supported = !!(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
    clearTimeout(this._restartTimer);
    if (this.recognition && this.running) {
      try { this.recognition.abort(); } catch { /* noop */ }
    }
    this.onListenerChange('servidor');
    if (this.active && !this.paused) this._sttStart();
  },

  // Pausa a escuta (durante processar/falar) sem desligar o modo.
  // No modo aplicativo isto é ESSENCIAL: sem parar o gravador, o Shadow
  // gravaria a própria voz e mandaria transcrever.
  pauseListening() {
    this.paused = true;
    clearTimeout(this._restartTimer);
    this._sttStop();
    if (this.recognition && this.running) {
      try { this.recognition.stop(); } catch { /* noop */ }
    }
  },
  resumeListening() {
    if (!this.active) return;
    this.paused = false;
    this.mode = 'listen';
    if (this.useStt) {
      // Respiro depois de falar: o alto-falante ainda tem o rabo da frase e a
      // sala devolve eco. Voltar a gravar na hora é pedir para se ouvir.
      this.lastSpokenAt = Date.now();
      clearTimeout(this._retomarTimer);
      this._retomarTimer = setTimeout(() => {
        if (this.active && !this.paused) this._sttStart();
      }, 700);
    } else {
      this._safeStart();
    }
  },

  setThinking(on) {
    this.mode = on ? 'think' : this.active ? 'listen' : 'off';
  },

  // ==================================================================
  //  ESCUTA POR GRAVAÇÃO + TRANSCRIÇÃO (modo aplicativo)
  //
  //  A Web Speech API do Chrome usa um serviço do Google com chave embutida
  //  no navegador — que o Electron não tem. Dentro do aplicativo ela sempre
  //  morre com o erro "network". Então aqui o Shadow grava trechos de fala,
  //  manda para /api/stt e o Gemini devolve o texto.
  //
  //  O gravador fica SEMPRE rodando e é reiniciado a cada trecho: assim o
  //  começo da frase nunca é cortado (a gravação já estava em andamento
  //  quando você começou a falar).
  // ==================================================================

  _sttLoop: false,
  _sttRec: null,
  _sttChunks: [],
  _sttTimer: null,
  _sttBusy: false,
  _ruido: 0.03, // piso de ruído do ambiente, aprendido sozinho

  _sttMime() {
    const tipos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return tipos.find((t) => window.MediaRecorder?.isTypeSupported(t)) || '';
  },

  async _sttStart() {
    if (this._sttLoop) return;
    await this.ensureAnalyser();
    if (!this._stream || !window.MediaRecorder) {
      this.onError('sem-microfone');
      return;
    }
    this._sttLoop = true;
    this._novoSegmento();
    this.onListenStart();
    clearInterval(this._sttTimer);
    this._sttTimer = setInterval(() => this._sttTick(), 100);
  },

  _sttStop() {
    this._sttLoop = false;
    clearTimeout(this._retomarTimer);
    clearInterval(this._sttTimer);
    this._sttTimer = null;
    if (this._sttRec && this._sttRec.state !== 'inactive') {
      this._seg && (this._seg.enviar = false);
      try { this._sttRec.stop(); } catch { /* noop */ }
    }
    this._sttRec = null;
    this.onListenStop();
  },

  _novoSegmento() {
    const mime = this._sttMime();
    let rec;
    try {
      // 24 kbps em Opus é de sobra para voz e deixa o envio pequeno — o que
      // sobe menos e o modelo processa mais rápido.
      const opcoes = mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined;
      rec = new MediaRecorder(this._stream, opcoes);
    } catch {
      this._sttLoop = false;
      this.onError('sem-gravador');
      return;
    }
    this._sttChunks = [];
    this._seg = { inicio: performance.now(), houveFala: false, inicioFala: 0, ultimoSom: 0, acima: 0, enviar: false };
    rec.ondataavailable = (e) => { if (e.data?.size) this._sttChunks.push(e.data); };

    rec.onstop = () => this._segmentoTerminou(mime);
    try { rec.start(); } catch { /* já parado */ }
    this._sttRec = rec;
  },

  _sttTick() {
    const seg = this._seg;
    const rec = this._sttRec;
    if (!this._sttLoop || !rec || !seg || rec.state !== 'recording') return;

    const nivel = this._micLevel();
    const agora = performance.now();

    // Limiar que se adapta ao ambiente: fica sempre acima do ruído de fundo.
    const limiar = Math.max(0.07, this._ruido * 2.4);
    if (nivel > limiar) {
      seg.acima++;
      if (seg.acima >= 2) { // ~200 ms de som: é fala, não um estalo
        if (!seg.houveFala) {
          seg.houveFala = true;
          seg.inicioFala = agora;
          this.onCapture(true); // "estou te ouvindo agora"
        }
        seg.ultimoSom = agora;
      }
    } else {
      seg.acima = 0;
      if (!seg.houveFala) this._ruido = this._ruido * 0.95 + nivel * 0.05;
    }

    const dur = agora - seg.inicio;
    if (seg.houveFala && agora - seg.ultimoSom > SILENCIO_MS) {
      // Silêncio depois de falar: fecha e manda transcrever.
      seg.enviar = seg.ultimoSom - seg.inicioFala > 250;
      this._pararSegmento();
    } else if (seg.houveFala && dur > MAX_FALA_MS) {
      seg.enviar = true; // frase quilométrica: manda o que tem
      this._pararSegmento();
    } else if (!seg.houveFala && dur > OCIOSO_MS) {
      // Só silêncio: descarta e recomeça. Segmentos ociosos curtos importam —
      // é o silêncio gravado ANTES da sua fala que vai junto para transcrever.
      seg.enviar = false;
      this._pararSegmento();
    }
  },

  _pararSegmento() {
    try { this._sttRec?.stop(); } catch { /* noop */ }
  },

  _segmentoTerminou(mime) {
    const enviar = this._seg?.enviar;
    if (this._seg?.houveFala) this.onCapture(false);
    const blob = new Blob(this._sttChunks, { type: mime || 'audio/webm' });
    this._sttChunks = [];
    this._sttRec = null;
    if (this._sttLoop) this._novoSegmento(); // já volta a ouvir
    if (enviar && blob.size > 1500) this._transcrever(blob);
  },

  async _transcrever(blob) {
    if (this._sttBusy) return; // uma transcrição por vez
    this._sttBusy = true;
    this.onSttThinking(true);
    try {
      const res = await fetch('/api/stt', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'falha na transcrição');
      const texto = (data.text || '').trim();
      if (!texto) return;
      if (this._pareceEco(texto)) {
        // Era ele mesmo voltando pelo microfone. Ignora em silêncio.
        return;
      }
      // `chamou` vem de quem OUVIU o áudio: é mais confiável do que procurar
      // o nome num texto onde "Shadow" pode ter virado "Cadê".
      this.onPhrase(texto, { chamou: !!data.calledByName });
    } catch (err) {
      this.onError('stt:' + (err?.message || 'falha'));
    } finally {
      this._sttBusy = false;
      this.onSttThinking(false);
    }
  },

  /**
   * O que voltou do microfone é a última fala DELE?
   *
   * Mesmo com o microfone fechado enquanto fala, sobra o rabo da frase e o eco
   * da sala. Sem esta trava o Shadow transcreve a si mesmo e responde sozinho.
   */
  _pareceEco(texto) {
    if (!this.lastText || !this.lastSpokenAt) return false;
    if (Date.now() - this.lastSpokenAt > 30000) return false; // faz tempo: não é eco

    const palavras = (s) =>
      String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((p) => p.length > 2);

    const ouvidas = palavras(texto);
    if (!ouvidas.length) return false;
    const ditas = new Set(palavras(this.lastText));
    if (!ditas.size) return false;

    const iguais = ouvidas.filter((p) => ditas.has(p)).length;
    return iguais / ouvidas.length >= 0.6; // maioria do que "ouvi" eu acabei de dizer
  },

  // ---------- Fala ----------

  /**
   * Fala um texto. Tenta a voz neural e cai na do navegador se precisar.
   * @param {string} text
   * @param {{engine?: 'neural'|'browser', voice?: string, silentFail?: boolean}} opts
   */
  async speak(text, opts = {}) {
    const clean = cleanForSpeech(text);
    this.cancelSpeak();
    if (!clean) {
      this.onSpeakEnd();
      return;
    }
    // Fechar o microfone é responsabilidade DAQUI, não de quem manda falar:
    // basta um lugar esquecer para o Shadow gravar a própria voz, transcrever
    // e responder a si mesmo. (Era o que acontecia com as dicas do Modo Jogo.)
    if (this.active && !this.paused) this.pauseListening();

    this.lastText = clean; // guardado para o "ouvir de novo" e contra eco
    this.lastSpokenAt = Date.now();

    const token = ++this._speakToken;
    const escolhido = opts.engine || this.engine;

    // Tenta o motor escolhido; se ele falhar, tenta o outro do servidor; e por
    // último a voz do navegador. O importante é nunca ficar mudo.
    const tentativas = [escolhido, escolhido === 'local' ? 'gemini' : 'local'].filter(
      (e, i, arr) => e !== 'browser' && this.engineAvailable(e) && arr.indexOf(e) === i
    );

    for (const engine of tentativas) {
      this.onSynthStart(engine);
      const wav = await this._fetchNeural(clean, engine, opts.voice).catch(() => null);
      if (token !== this._speakToken) return; // cancelado enquanto sintetizava
      if (wav) {
        this._useEngine(engine);
        this._playNeural(wav, token, clean);
        return;
      }
    }

    if (token !== this._speakToken) return;
    this._useEngine('browser');
    this._speakBrowser(clean, token);
  },

  _useEngine(name) {
    this.lastEngineUsed = name;
    this.onEngineUsed(name);
  },

  async _fetchNeural(text, engine, voice) {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, engine, voice: voice || this.neural.voice }),
    });
    if (!res.ok) throw new Error('tts indisponível');
    return await res.blob();
  },

  _playNeural(blob, token, text) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = this.volume;
    this._audio = audio;

    let ended = false;
    const finish = () => {
      if (ended || token !== this._speakToken) return;
      ended = true;
      URL.revokeObjectURL(url);
      if (this._audio === audio) this._audio = null;
      this.mode = this.active ? 'listen' : 'off';
      this.onSpeakEnd();
    };

    audio.onplaying = () => {
      this.mode = 'speak';
      this.onSpeakStart();
    };
    audio.onended = finish;
    audio.onerror = () => {
      // Não conseguiu tocar o WAV: usa a voz do navegador para não ficar mudo.
      if (ended || token !== this._speakToken) return;
      ended = true;
      URL.revokeObjectURL(url);
      this._useEngine('browser');
      this._speakBrowser(text, token);
    };

    this._attachOutputAnalyser(audio);
    audio.play().catch(() => {
      // Bloqueio de autoplay (sem interação do usuário ainda).
      if (ended || token !== this._speakToken) return;
      ended = true;
      URL.revokeObjectURL(url);
      this.mode = this.active ? 'listen' : 'off';
      this.onSpeakEnd();
    });
  },

  // Fala do navegador, quebrada em frases: pausas naturais e sem o bug
  // do Chrome que corta falas longas.
  _speakBrowser(text, token) {
    if (!window.speechSynthesis || !text) {
      this.onSpeakEnd();
      return;
    }
    const parts = splitSentences(text);
    let i = 0;

    const done = () => {
      if (token !== this._speakToken) return;
      this.mode = this.active ? 'listen' : 'off';
      this.onSpeakEnd();
    };

    const next = () => {
      if (token !== this._speakToken) return;
      if (i >= parts.length) return done();
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (this.ptVoice) u.voice = this.ptVoice;
      u.lang = 'pt-BR';
      u.rate = BROWSER_RATE;
      u.pitch = BROWSER_PITCH;
      u.volume = this.volume;
      if (i === 1) {
        u.onstart = () => {
          this.mode = 'speak';
          this.onSpeakStart();
        };
      }
      u.onend = next;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    };
    next();
  },

  /** Repete a última fala. Devolve false se ainda não houve nenhuma. */
  repeat() {
    if (!this.lastText) return false;
    this.speak(this.lastText);
    return true;
  },

  /** Está falando agora? */
  isSpeaking() {
    return this.mode === 'speak' || !!this._audio || !!window.speechSynthesis?.speaking;
  },

  cancelSpeak() {
    this._speakToken++;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (this._audio) {
      try { this._audio.pause(); } catch { /* noop */ }
      this._audio = null;
    }
  },

  // ---------- Vozes do navegador (motor de reserva) ----------

  listBrowserVoices() {
    if (!window.speechSynthesis) return [];
    return window.speechSynthesis
      .getVoices()
      .filter((v) => /pt(-|_)?BR/i.test(v.lang) || /portugu/i.test(v.name));
  },

  _loadVoices() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    const pt = voices.filter(
      (v) => /pt(-|_)?BR/i.test(v.lang) || /portugu/i.test(v.name)
    );

    const chosen = localStorage.getItem(LS.browser);
    if (chosen) {
      const found = pt.find((v) => v.name === chosen);
      if (found) {
        this.ptVoice = found;
        return;
      }
    }

    // Pontua as vozes para escolher a mais natural disponível.
    // "Online (Natural)" são as vozes neurais da Microsoft — só existem no Edge.
    const score = (v) => {
      const n = (v.name || '').toLowerCase();
      let s = 0;
      if (/pt-?br/i.test(v.lang)) s += 4;
      if (/natural/.test(n)) s += 20;
      if (/online|neural/.test(n)) s += 10;
      if (/google/.test(n)) s += 6;
      if (!v.localService) s += 3; // vozes de rede costumam ser as novas
      return s;
    };
    this.ptVoice =
      pt.sort((a, b) => score(b) - score(a))[0] ||
      voices.find((v) => /pt/i.test(v.lang)) ||
      null;
  },

  // ---------- Áudio: microfone e saída ----------

  async ensureAnalyser() {
    if (this._analyser || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this._stream = stream; // guardado: é dele que a gravação sai
      this._analyser = analyser;
      this._data = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      /* sem microfone: reator anima em modo ambiente */
    }
  },

  /** Volume do microfone agora (0 a 1). */
  _micLevel() {
    if (!this._analyser) return 0;
    this._analyser.getByteFrequencyData(this._data);
    let soma = 0;
    for (let i = 0; i < this._data.length; i++) soma += this._data[i];
    return Math.min(1, soma / this._data.length / 90);
  },

  _unlockAudio() {
    try {
      this._outCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this._outCtx.state === 'suspended') this._outCtx.resume();
    } catch { /* noop */ }
  },

  // Liga a saída de voz a um analisador, para o reator pulsar no ritmo real
  // da fala (e não numa senoide falsa).
  _attachOutputAnalyser(audio) {
    this._outAnalyser = null;
    try {
      this._unlockAudio();
      const ctx = this._outCtx;
      // Se o contexto não estiver rodando, NÃO desviamos o áudio por ele —
      // sairia mudo. Melhor tocar direto e animar o reator no modo simulado.
      if (!ctx || ctx.state !== 'running') return;
      try { this._outSrc?.disconnect(); } catch { /* noop */ }
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      this._outSrc = src;
      this._outAnalyser = analyser;
      this._outData = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      this._outAnalyser = null; // segue tocando normalmente, só sem visualização
    }
  },

  _startLevelLoop() {
    const tick = () => {
      let level = 0;
      if (this.mode === 'listen' && this._analyser) {
        level = this._micLevel();
      } else if (this.mode === 'speak') {
        if (this._audio && this._outAnalyser) {
          this._outAnalyser.getByteFrequencyData(this._outData);
          let sum = 0;
          for (let i = 0; i < this._outData.length; i++) sum += this._outData[i];
          level = Math.min(1, 0.12 + sum / this._outData.length / 70);
        } else {
          level = 0.35 + Math.abs(Math.sin(performance.now() / 120)) * 0.4;
        }
      } else if (this.mode === 'think') {
        level = 0.25 + Math.abs(Math.sin(performance.now() / 260)) * 0.2;
      } else {
        level = 0.06 + Math.abs(Math.sin(performance.now() / 900)) * 0.05;
      }
      this.onLevel(level);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
};

/** Volume guardado (0 a 1). Sem nada salvo, começa em 80%. */
function readVolume() {
  const salvo = localStorage.getItem(LS.volume);
  if (salvo == null) return 0.8; // Number(null) daria 0 — o Shadow nasceria mudo
  const v = Number(salvo);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.8;
}

// ---------- Texto pronto para ser falado ----------

/** Tira do texto tudo que uma pessoa não falaria em voz alta. */
function cleanForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/[*_#>|]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' o link ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quebra em frases curtas para a fala respirar entre elas. */
function splitSentences(text, max = 180) {
  const out = [];
  for (const piece of text.split(/(?<=[.!?…:;])\s+/)) {
    if (piece.length <= max) {
      if (piece.trim()) out.push(piece.trim());
      continue;
    }
    let rest = piece;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(' ', max);
      const at = cut > 40 ? cut : max;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at);
    }
    if (rest.trim()) out.push(rest.trim());
  }
  return out.length ? out : [text];
}
