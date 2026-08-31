// Reator Arc animado em canvas — o núcleo visual do Shadow.
// Camadas: halo, anéis de marcação, anéis segmentados, nós de energia
// em órbita, anel reativo ao áudio, partículas à deriva, moldura hexagonal
// e o núcleo pulsante com o triângulo do reator.

const PALETTE = {
  idle:      { main: '#b06bff', glow: 'rgba(176,107,255,0.9)', accent: '#d8bcff', cyan: '#3fe6ff' },
  listening: { main: '#3fe6ff', glow: 'rgba(63,230,255,0.9)',  accent: '#bff4ff', cyan: '#8b7bff' },
  armed:     { main: '#ff6ad5', glow: 'rgba(255,106,213,0.9)', accent: '#ffb0ec', cyan: '#ff9ae0' },
  thinking:  { main: '#b06bff', glow: 'rgba(176,107,255,0.95)',accent: '#e0c8ff', cyan: '#3fe6ff' },
  speaking:  { main: '#c08bff', glow: 'rgba(192,139,255,0.9)', accent: '#ead6ff', cyan: '#66eaff' },
};

export const HUD = {
  canvas: null,
  ctx: null,
  state: 'idle',
  level: 0,
  smooth: 0,
  t: 0,
  particles: [],

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._resize();
    this._seedParticles();
    window.addEventListener('resize', () => this._resize());
    requestAnimationFrame((ts) => this._loop(ts));
  },

  setState(state) { if (PALETTE[state]) this.state = state; },
  setLevel(v) { this.level = Math.max(0, Math.min(1, v)); },

  _seedParticles() {
    this.particles = Array.from({ length: 28 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.32 + Math.random() * 0.55,   // fração do raio
      speed: 0.05 + Math.random() * 0.18,
      size: 0.6 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    }));
  },

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  },

  _loop(ts) {
    this.t = ts / 1000;
    const rect = this.canvas.getBoundingClientRect();
    if (Math.abs(rect.width - (this.w || 0)) > 1 || Math.abs(rect.height - (this.h || 0)) > 1) {
      this._resize();
    }
    this.smooth += (this.level - this.smooth) * 0.18;
    this._draw();
    requestAnimationFrame((t) => this._loop(t));
  },

  _draw() {
    const { ctx, w, h, t } = this;
    if (!ctx) return;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2;
    const p = PALETTE[this.state];
    const pulse =
      this.state === 'thinking' ? 1.4 :
      this.state === 'armed' ? 1.25 :
      this.state === 'listening' ? 1.1 : 0.7;
    const amp = this.smooth;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(cx, cy);

    // Halo de fundo (dois tons)
    const halo = ctx.createRadialGradient(0, 0, R * 0.08, 0, 0, R);
    halo.addColorStop(0, p.glow.replace('0.9', '0.22'));
    halo.addColorStop(0.5, p.glow.replace('0.9', '0.07'));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();

    // Anel externo tracejado girando
    this._dashRing(R * 0.98, t * 0.08, p.accent, 0.3);

    // Anel externo com marcações
    this._ticks(R * 0.92, 72, t * 0.15 * pulse, p.main, 0.5);

    // Anéis segmentados em sentidos opostos (um ciano)
    this._segRing(R * 0.82, t * -0.35 * pulse, 6, 0.34, p.main);
    this._segRing(R * 0.70, t * 0.5 * pulse, 4, 0.5, p.cyan);

    // Nós de energia em órbita
    this._orbitNodes(R * 0.66, t * 0.6 * pulse, 3, p.cyan);
    this._orbitNodes(R * 0.76, t * -0.4 * pulse, 2, p.accent);

    // Anel reativo ao áudio
    ctx.lineWidth = 2 + amp * 8;
    ctx.strokeStyle = p.main;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 18 + amp * 34;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.12) {
      const wobble = Math.sin(a * 6 + t * 4) * amp * (R * 0.06);
      const rr = R * 0.58 + wobble;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Partículas à deriva (sobem e reaparecem)
    this._particles(R, p, amp);

    // Marcações internas finas
    this._ticks(R * 0.46, 48, t * -0.2, p.accent, 0.3);

    // Moldura hexagonal ao redor do núcleo
    this._hexagon(R * 0.40, t * 0.12, p.main, 0.4);

    // Núcleo central pulsante
    const coreR = R * 0.30 * (1 + amp * 0.25 + Math.sin(t * 2) * 0.03);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.28, p.accent);
    core.addColorStop(0.6, p.main);
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 44 + amp * 44;
    ctx.beginPath(); ctx.arc(0, 0, coreR, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Triângulo do reator
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2 + t * 0.1;
      const x = Math.cos(a) * coreR * 0.6, y = Math.sin(a) * coreR * 0.6;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();

    ctx.restore();
  },

  _ticks(radius, count, rot, color, alpha) {
    const { ctx } = this;
    ctx.save();
    ctx.rotate(rot);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const long = i % 6 === 0;
      const r1 = radius, r2 = radius - (long ? 12 : 5);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  _segRing(radius, rot, segments, gap, color) {
    const { ctx } = this;
    ctx.save();
    ctx.rotate(rot);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const seg = (Math.PI * 2) / segments;
    for (let i = 0; i < segments; i++) {
      const start = i * seg;
      ctx.beginPath();
      ctx.arc(0, 0, radius, start, start + seg * (1 - gap));
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  _dashRing(radius, rot, color, alpha) {
    const { ctx } = this;
    ctx.save();
    ctx.rotate(rot);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 10]);
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  _orbitNodes(radius, rot, count, color) {
    const { ctx } = this;
    ctx.save();
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  },

  _hexagon(radius, rot, color, alpha) {
    const { ctx } = this;
    ctx.save();
    ctx.rotate(rot);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  _particles(R, p, amp) {
    const { ctx, t } = this;
    ctx.save();
    ctx.fillStyle = p.cyan;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 8;
    for (const pt of this.particles) {
      pt.a += pt.speed * 0.01;
      const breathe = Math.sin(t * 0.8 + pt.phase) * 0.03;
      const rr = R * (pt.r + breathe);
      const x = Math.cos(pt.a) * rr, y = Math.sin(pt.a) * rr;
      const twinkle = 0.35 + (Math.sin(t * 2 + pt.phase) * 0.5 + 0.5) * 0.5;
      ctx.globalAlpha = twinkle * (0.5 + amp * 0.5);
      ctx.beginPath(); ctx.arc(x, y, pt.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  },
};
