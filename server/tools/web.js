/**
 * Busca na web GRÁTIS e sem cota, via DuckDuckGo.
 * Retorna trechos de texto dos melhores resultados; o modelo (Gemini) usa
 * esses trechos para responder com o essencial.
 * (Evita a "busca do Google" do Gemini, que é bem limitada no plano grátis.)
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchWeb(query) {
  const q = String(query || '').trim();
  if (!q) return 'Busca vazia.';
  const results = [];

  // 1) Resposta instantânea (definições, fatos rápidos).
  try {
    const url =
      'https://api.duckduckgo.com/?q=' +
      encodeURIComponent(q) +
      '&format=json&no_html=1&skip_disambig=1&kl=br-pt';
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (data.AbstractText) results.push(data.AbstractText);
    else if (data.Answer) results.push(String(data.Answer));
  } catch {
    /* ignora */
  }

  // 2) Trechos dos principais resultados de busca.
  try {
    const url =
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kl=br-pt';
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
    const html = await res.text();
    const snippets = [...html.matchAll(/result__snippet[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => stripHtml(m[1]))
      .filter((s) => s.length > 20)
      .slice(0, 5);
    results.push(...snippets);
  } catch {
    /* ignora */
  }

  if (results.length === 0) {
    return 'Não encontrei resultados na web para essa busca. Tente reformular.';
  }
  // Remove duplicados e limita o tamanho entregue ao modelo.
  const unique = [...new Set(results)].slice(0, 6);
  return `Resultados da web para "${q}":\n` + unique.map((r) => '• ' + r).join('\n');
}
