// Gráficos do Modo Jogo — SVG desenhado à mão.
//
// Sem biblioteca de fora de propósito: o Shadow roda offline e dentro de um app
// empacotado, então qualquer CDN seria um ponto de falha. São poucos tipos de
// gráfico e todos cabem em algumas dezenas de linhas.
//
// Todos recebem dados já prontos e devolvem uma string de SVG.

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const COR = {
  aliado: '#3fe6ff',
  inimigo: '#ff5b8a',
  voce: '#ffcf5a',
  grade: 'rgba(176,107,255,.16)',
  texto: '#9385b8',
};

/**
 * Gráfico de linhas com duas séries (você/seu time × inimigo).
 * @param {{titulo: string, pontos: {t: number, a: number, b: number}[],
 *          rotuloA: string, rotuloB: string, altura?: number}} cfg
 */
export function linhaDupla({ titulo, pontos, rotuloA, rotuloB, altura = 120 }) {
  const L = 34, R = 8, T = 8, B = 18; // margens
  const W = 320, H = altura;
  const areaW = W - L - R;
  const areaH = H - T - B;

  if (!pontos || pontos.length < 2) {
    return caixaVazia(titulo, 'juntando dados da partida…', W, H);
  }

  const maxY = Math.max(1, ...pontos.map((p) => Math.max(p.a, p.b)));
  const maxT = Math.max(1, pontos[pontos.length - 1].t);
  const x = (t) => L + (t / maxT) * areaW;
  const y = (v) => T + areaH - (v / maxY) * areaH;

  const caminho = (campo) =>
    pontos.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[campo]).toFixed(1)}`).join(' ');

  // Três linhas de grade horizontais, com o valor à esquerda.
  const grade = [0, 0.5, 1]
    .map((f) => {
      const v = Math.round(maxY * f);
      const yy = y(v);
      return (
        `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="${COR.grade}" stroke-width="1"/>` +
        `<text x="${L - 5}" y="${yy + 3}" text-anchor="end" font-size="8" fill="${COR.texto}">${v}</text>`
      );
    })
    .join('');

  const ultimo = pontos[pontos.length - 1];
  return `
<figure class="grafico">
  <figcaption>${esc(titulo)}
    <span class="g-leg"><i style="background:${COR.aliado}"></i>${esc(rotuloA)} <b>${ultimo.a}</b></span>
    <span class="g-leg"><i style="background:${COR.inimigo}"></i>${esc(rotuloB)} <b>${ultimo.b}</b></span>
  </figcaption>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    ${grade}
    <path d="${caminho('b')}" fill="none" stroke="${COR.inimigo}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${caminho('a')}" fill="none" stroke="${COR.aliado}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(ultimo.t).toFixed(1)}" cy="${y(ultimo.a).toFixed(1)}" r="3" fill="${COR.aliado}"/>
    <circle cx="${x(ultimo.t).toFixed(1)}" cy="${y(ultimo.b).toFixed(1)}" r="3" fill="${COR.inimigo}"/>
  </svg>
</figure>`;
}

/**
 * Barras horizontais comparando os dois times item a item.
 * @param {{titulo: string, itens: {rotulo: string, a: number|null, b: number|null}[]}} cfg
 */
export function barrasComparadas({ titulo, itens }) {
  const linhas = itens
    .map(({ rotulo, a, b }) => {
      if (a == null || b == null) {
        return `<div class="bc-linha"><span class="bc-rot">${esc(rotulo)}</span>
          <span class="bc-nd">n/d</span></div>`;
      }
      const total = Math.max(1, a + b);
      const pa = (a / total) * 100;
      return `<div class="bc-linha">
        <span class="bc-rot">${esc(rotulo)}</span>
        <span class="bc-val a">${a}</span>
        <span class="bc-barra"><i class="a" style="width:${pa.toFixed(1)}%"></i><i class="b" style="width:${(100 - pa).toFixed(1)}%"></i></span>
        <span class="bc-val b">${b}</span>
      </div>`;
    })
    .join('');
  return `<figure class="grafico barras"><figcaption>${esc(titulo)}</figcaption>${linhas}</figure>`;
}

/**
 * Barras de KDA por jogador, um time de cada lado.
 * @param {{titulo: string, jogadores: {campeao: string, valor: number, isMe?: boolean}[],
 *          cor: string, max: number}} cfg
 */
export function barrasJogadores({ titulo, jogadores, cor, max }) {
  const teto = Math.max(1, max);
  const linhas = jogadores
    .map((j) => {
      const largura = Math.min(100, (j.valor / teto) * 100);
      return `<div class="bj-linha${j.isMe ? ' eu' : ''}">
        <span class="bj-nome">${esc(j.campeao)}</span>
        <span class="bj-barra"><i style="width:${largura.toFixed(1)}%;background:${j.isMe ? COR.voce : cor}"></i></span>
        <span class="bj-val">${j.valor}</span>
      </div>`;
    })
    .join('');
  return `<figure class="grafico jogadores"><figcaption>${esc(titulo)}</figcaption>${linhas}</figure>`;
}

/** Medidor circular (usado no desempenho do PC: CPU, GPU, FPS). */
export function medidor({ rotulo, valor, unidade = '%', pct, cor = '#b06bff', nota = '' }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const preenchido = Math.max(0, Math.min(1, (pct ?? 0) / 100)) * circ;
  const texto = valor == null ? 'n/d' : `${valor}${unidade}`;
  return `
<div class="medidor${valor == null ? ' vazio' : ''}" title="${esc(nota)}">
  <svg viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="6"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${cor}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${preenchido.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 32 32)"/>
  </svg>
  <b>${esc(texto)}</b>
  <span>${esc(rotulo)}</span>
</div>`;
}

function caixaVazia(titulo, mensagem, W, H) {
  return `
<figure class="grafico vazio">
  <figcaption>${esc(titulo)}</figcaption>
  <svg viewBox="0 0 ${W} ${H}"><text x="${W / 2}" y="${H / 2}" text-anchor="middle"
    font-size="11" fill="${COR.texto}">${esc(mensagem)}</text></svg>
</figure>`;
}
