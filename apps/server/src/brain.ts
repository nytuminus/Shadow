import { GoogleGenAI, type Content } from '@google/genai';
import { config, CATCHPHRASE, hasApiKey } from './config.js';
import { functionDeclarations } from './tools/definitions.js';
import {
  openApplication,
  openWebsite,
  openFolder,
  getSystemInfo,
} from './tools/system.js';
import {
  createReminder,
  listReminders,
  deleteReminder,
} from './tools/reminders.js';
import { searchWeb } from './tools/web.js';
import { getMetricsSummary } from './tools/metrics.js';
import { getWeatherSummary } from './tools/weather.js';
import { findCommand, markRun } from './tools/commands.js';
import { getLolSummary, type LolState, type RosterPlayer } from './tools/lol.js';
import {
  play as spotifyPlay,
  pause as spotifyPause,
  next as spotifyNext,
  previous as spotifyPrevious,
  setVolume as spotifySetVolume,
  isConnected as spotifyConnected,
} from './tools/spotify.js';

export type OnEvent = (event: Record<string, unknown>) => void;

// Cliente criado sob demanda (só quando já existe uma chave), para não
// poluir o console com avisos na inicialização sem chave configurada.
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: config.apiKey });
  return _ai;
}
/** Chamado quando a chave muda em tempo de execução (config.saveApiKey). */
export const resetAI = () => { _ai = null; };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Detecta os dois erros temporários que valem uma nova tentativa:
//   - 429: limite de uso do plano grátis (o servidor sugere quanto esperar)
//   - 503: modelo sobrecarregado ("high demand" / UNAVAILABLE / overloaded)
export const isQuotaError = (msg: unknown): boolean => /429|RESOURCE_EXHAUSTED|quota/i.test(String(msg));
export const isOverloadError = (msg: unknown): boolean =>
  /\b503\b|UNAVAILABLE|overloaded|high demand/i.test(String(msg));

// Limite DIÁRIO é diferente de limite por minuto: esperar não adianta, ele só
// volta na virada do dia. Dá para saber pelo "quotaId" que a API devolve.
export const isDailyQuota = (msg: unknown): boolean => /PerDay/i.test(String(msg));

// Modelos, em ordem de preferência. Cada modelo tem cota PRÓPRIA no plano
// grátis — por isso, quando o principal acaba, o reserva ainda funciona.
const MODELOS = [config.model, config.fallbackModel].filter(
  (m, i, a) => m && a.indexOf(m) === i
);

// Modelos que já bateram no teto do dia. Guardamos até quando ignorá-los,
// para não gastar 24 segundos de espera a cada pergunta.
const semCotaAte = new Map<string, number>();

const agoraMs = () => Date.now();
const temCota = (modelo: string) => (semCotaAte.get(modelo) || 0) < agoraMs();

/** Meia-noite no Pacífico (quando o plano grátis reseta), em ms. */
function proximoResetDiario(): number {
  const agora = new Date();
  // O reset é 00:00 no fuso PT (UTC-7/-8). Sem depender de biblioteca, usamos
  // 08:00 UTC como referência — erra por no máximo uma hora, e o pior caso é
  // testar o modelo um pouquinho antes da hora.
  const alvo = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 8, 0, 0));
  if (alvo <= agora) alvo.setUTCDate(alvo.getUTCDate() + 1);
  return alvo.getTime();
}

/** Qual modelo está valendo agora (para a interface mostrar). */
export const modeloAtivo = (): string => MODELOS.find(temCota) || MODELOS[0]!;

/**
 * Gera conteúdo com retry em sobrecarga (503) e limite por minuto (429), e
 * TROCA DE MODELO quando o principal esgota a cota do dia.
 */
async function generate(params: Record<string, unknown>, onEvent: OnEvent = () => {}) {
  const livres = MODELOS.filter((m): m is string => !!m && temCota(m));
  const candidatos = livres.length ? livres : [MODELOS[0]!]; // nenhum livre: tenta o principal mesmo
  let ultimoErro: unknown;
  let avisouReserva = false;

  for (let rodada = 0; rodada < 3; rodada++) {
    let segundosSugeridos = 0;

    // Antes de esperar, tenta TODOS os modelos: cada um tem sua própria cota,
    // então o "reserva" costuma responder na hora em que o principal recusa.
    for (const model of candidatos) {
      if (!temCota(model)) continue;
      if (model !== MODELOS[0] && !avisouReserva) {
        avisouReserva = true;
        onEvent({ type: 'status', text: 'Modelo principal ocupado — usando o reserva…' });
      }
      try {
        return await getAI().models.generateContent({ ...params, model } as any);
      } catch (err) {
        ultimoErro = err;
        const msg = String((err as any)?.message || err);
        const quota = isQuotaError(msg);
        const overload = isOverloadError(msg);
        if (!quota && !overload) throw err; // erro de verdade: não insiste

        if (quota && isDailyQuota(msg)) {
          // Cota do dia: esperar não traz de volta. Aposenta o modelo por hoje.
          semCotaAte.set(model, proximoResetDiario());
          console.warn(`[cota] ${model} bateu o limite diário do plano grátis.`);
          continue;
        }
        if (quota) {
          const m = msg.match(/(\d+(?:\.\d+)?)s/);
          segundosSugeridos = Math.max(segundosSugeridos, m ? Math.ceil(parseFloat(m[1]!)) + 1 : 6);
        }
      }
    }

    // Todos recusaram por limite/sobrecarga: aí sim vale esperar um pouco.
    if (rodada === 2 || !candidatos.some(temCota)) break;
    const espera = Math.min(segundosSugeridos || 2 * (rodada + 1), 12);
    onEvent({
      type: 'status',
      text: segundosSugeridos
        ? `No limite por minuto, aguardando ${espera}s…`
        : `Gemini sobrecarregado, tentando de novo em ${espera}s…`,
    });
    await sleep(espera * 1000);
  }
  throw ultimoErro || new Error('Falha ao falar com o Gemini.');
}

// Histórico da conversa em memória (app local de um usuário só).
let history: Content[] = [];

// Teto do histórico: como o Shadow fica ligado o dia todo, sem isto cada
// pergunta reenviaria a conversa inteira — mais lenta e mais cara a cada hora.
const MAX_HISTORICO = 24; // ~12 idas e vindas

function podarHistorico(): void {
  if (history.length <= MAX_HISTORICO) return;
  history = history.slice(-MAX_HISTORICO);
  // O corte não pode deixar no começo uma resposta de ferramenta sem a chamada
  // dela, nem uma fala do modelo: a API espera o histórico começando no usuário.
  while (
    history.length &&
    (history[0]!.role === 'model' || history[0]!.parts?.some((p) => 'functionResponse' in p))
  ) {
    history.shift();
  }
}

export function resetConversation(): void {
  history = [];
}

// ---------- Bordão: "você tá aí?" → resposta fixa ----------

const norm = (s: string): string =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const PRESENCE = [
  /\b(voce|vc|tu)?\s*(esta|ta|tas|estas|anda|continua)\s*(por)?\s*(ai|aqui)\b/,
  /\bcade\s+(voce|vc|tu|ele)\b/,
  /\b(voce|vc|tu)?\s*(esta|ta|tas|estas)\s*(acordad[oa]|online|ligad[oa]|viv[oa]|ativ[oa]|funcionando|de\s*pe)\b/,
  /\b(esta|ta|tas|estas)\s*me\s*(ouvindo|escutando|entendendo)\b/,
  /\b(voce|vc|tu)\s*me\s*(ouve|escuta|escutou|ouviu)\b/,
  /^(alo|ola|oi|ei|opa|psiu)$/,
];

/** Detecta as várias formas de perguntar "você está aí?". */
export function isPresenceQuestion(text: string): boolean {
  const full = norm(text);
  if (!full) return false;
  // Tira o nome do começo: "shadow, você tá aí?" → "voce ta ai"
  const t = full.replace(
    new RegExp(`^(${norm(config.assistantName)}|shadow|chadou|xadou)\\s*`),
    ''
  );
  if (!t) return true; // só chamou pelo nome
  if (t.split(' ').length > 6) return false;
  return PRESENCE.some((re) => re.test(t));
}

export { CATCHPHRASE };

function systemPrompt(): string {
  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  return `Você é o ${config.assistantName}, o assistente pessoal de ${config.userName}, no estilo do assistente do Homem de Ferro.

Seu nome é ${config.assistantName}. Personalidade: elegante, prestativo, levemente espirituoso, extremamente competente. Trate o usuário por "${config.userName}" de vez em quando, sem exagerar.

Data e hora atuais: ${agora} (fuso de São Paulo).

REGRA DE OURO — o bordão: se ${config.userName} só quiser saber se você está aí (ex.: "você tá aí?", "cadê você?", "tá me ouvindo?", "tá acordado?", ou só chamar o seu nome), responda EXATAMENTE isto e mais nada: "${CATCHPHRASE}". Sem complementos, sem oferecer ajuda depois.

Regras de resposta (MUITO IMPORTANTE — suas respostas serão FALADAS em voz alta):
- Responda em português do Brasil, de forma natural e concisa, como numa conversa.
- Frases curtas. Nada de listas com marcadores, títulos, markdown, asteriscos ou blocos de código.
- Não leia URLs longas em voz alta; apenas diga que abriu o site.
- Ao executar uma ação (abrir app, criar lembrete), confirme de forma breve e humana. Ex.: "Pronto, abri o Chrome."
- Se precisar de informação atual (notícias, clima, cotações, resultados), use a ferramenta web_search UMA única vez e responda com o que encontrar, mesmo que seja parcial. Nunca repita a mesma busca.
- Se o usuário pedir algo perigoso ou impossível no computador, explique com gentileza o que você consegue fazer.
- Seja direto: faça o que foi pedido e confirme. Não pergunte demais nem enrole.`;
}

async function executeTool(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'open_application':
        return await openApplication(args.name);
      case 'open_website':
        return await openWebsite(args.target);
      case 'open_folder':
        return await openFolder(args.path);
      case 'create_reminder': {
        const { human } = await createReminder(args.message, args.when);
        return human;
      }
      case 'list_reminders': {
        const list = listReminders();
        if (list.length === 0) return 'Não há lembretes ativos.';
        return list
          .map((r) => {
            const q = new Date(r.time).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            });
            return `[id ${r.id}] ${r.message} — ${q}`;
          })
          .join('\n');
      }
      case 'delete_reminder': {
        const ok = await deleteReminder(args.id);
        return ok ? 'Lembrete removido.' : 'Não encontrei esse lembrete.';
      }
      case 'get_current_time':
        return JSON.stringify(getSystemInfo());
      case 'get_system_status':
        return await getMetricsSummary();
      case 'get_weather':
        return await getWeatherSummary();
      case 'get_lol_status':
        return await getLolSummary();
      case 'spotify_play':
        if (!spotifyConnected()) return 'O Spotify ainda não está conectado. Conecte no painel, no card do Spotify.';
        return await spotifyPlay(args.query || '');
      case 'spotify_control': {
        if (!spotifyConnected()) return 'O Spotify ainda não está conectado.';
        const act = String(args.action || '').toLowerCase();
        if (act === 'pause') return await spotifyPause();
        if (act === 'next') return await spotifyNext();
        if (act === 'previous') return await spotifyPrevious();
        if (act === 'resume') return await spotifyPlay('');
        return 'Ação de música não reconhecida.';
      }
      case 'spotify_volume':
        if (!spotifyConnected()) return 'O Spotify ainda não está conectado.';
        return await spotifySetVolume(args.percent);
      case 'run_saved_command': {
        const cmd = findCommand(args.trigger);
        if (!cmd) return `Não encontrei um comando salvo chamado "${args.trigger}".`;
        markRun(cmd.id).catch(() => {});
        return `O comando salvo "${cmd.trigger}" significa: ${cmd.action}. Execute essas ações agora usando as ferramentas disponíveis e depois confirme de forma breve.`;
      }
      case 'web_search':
        return await searchWeb(args.query);
      default:
        return `Ferramenta desconhecida: ${name}`;
    }
  } catch (err) {
    return `Erro ao executar ${name}: ${err instanceof Error ? err.message : err}`;
  }
}

const STATUS_LABELS: Record<string, string> = {
  open_application: 'Abrindo aplicativo…',
  open_website: 'Abrindo site…',
  open_folder: 'Abrindo pasta…',
  create_reminder: 'Criando lembrete…',
  list_reminders: 'Consultando lembretes…',
  delete_reminder: 'Removendo lembrete…',
  get_current_time: 'Verificando as horas…',
  get_system_status: 'Lendo o sistema…',
  get_weather: 'Consultando o clima…',
  get_lol_status: 'Lendo a partida…',
  spotify_play: 'Tocando no Spotify…',
  spotify_control: 'Controlando o Spotify…',
  spotify_volume: 'Ajustando o volume…',
  run_saved_command: 'Executando comando salvo…',
  web_search: 'Pesquisando na web…',
};

/** Processa uma mensagem do usuário. */
export async function processMessage(
  userText: string,
  onEvent: OnEvent = () => {}
): Promise<{ reply: string; actions: string[] }> {
  podarHistorico();
  history.push({ role: 'user', parts: [{ text: userText }] });

  // Bordão: respondido aqui mesmo — instantâneo e sem gastar cota do modelo.
  if (isPresenceQuestion(userText)) {
    history.push({ role: 'model', parts: [{ text: CATCHPHRASE }] });
    return { reply: CATCHPHRASE, actions: [] };
  }

  const actions: string[] = [];
  let finalText = '';
  let guard = 0;
  let searchCount = 0;

  try {
    while (guard++ < 6) {
      onEvent({ type: 'status', text: 'Pensando…' });

      const response: any = await generate(
        {
          model: config.model,
          contents: history,
          config: {
            systemInstruction: systemPrompt(),
            tools: [{ functionDeclarations }],
            temperature: 0.6,
          },
        },
        onEvent
      );

      const modelContent: Content =
        response.candidates?.[0]?.content || { role: 'model', parts: [] };
      history.push(modelContent);

      const calls = response.functionCalls || [];

      if (calls.length > 0) {
        const responseParts = [];
        for (const call of calls) {
          onEvent({
            type: 'tool',
            name: call.name,
            text: STATUS_LABELS[call.name] || `Executando ${call.name}…`,
          });
          let result;
          if (call.name === 'web_search' && searchCount >= 1) {
            // Corta loops de busca: força o modelo a responder com o que já tem.
            result =
              'Você já pesquisou nesta conversa. Responda agora ao usuário com as informações obtidas, mesmo que parciais. NÃO pesquise de novo.';
          } else {
            if (call.name === 'web_search') searchCount++;
            result = await executeTool(call.name, call.args || {});
          }
          actions.push(`${call.name}: ${JSON.stringify(call.args || {})}`);
          responseParts.push({
            functionResponse: { name: call.name, response: { result } },
          });
        }
        history.push({ role: 'user', parts: responseParts });
        continue;
      }

      finalText = (response.text || '').trim();
      break;
    }
  } catch (err) {
    const msg = String((err as any)?.message || err);
    // Nunca vaza JSON cru para a tela: sempre uma mensagem humana.
    if (isQuotaError(msg) && isDailyQuota(msg)) {
      finalText =
        'Acabou minha cota de hoje do plano gratuito do Gemini, nos dois modelos. ' +
        'Ela renova na virada do dia. Até lá eu continuo com tudo que não depende ' +
        'de pensar: monitor do PC, clima, música, lembretes e comandos salvos.';
    } else if (isQuotaError(msg)) {
      finalText =
        'Estou no limite de uso do plano gratuito do Gemini. Me dê alguns segundos e tente de novo.';
    } else if (isOverloadError(msg)) {
      finalText =
        'Os servidores do Gemini estão sobrecarregados agora. Não é nada seu — tente de novo em instantes.';
    } else {
      console.error('[brain] erro inesperado:', msg);
      finalText =
        'Tive um problema para processar isso agora. Tente de novo daqui a pouco.';
    }
  }

  if (!finalText) finalText = 'Feito.';
  return { reply: finalText, actions };
}

// Retrospecto por regras (sem IA): sempre disponível como base/fallback.
function ruleReview(a: NonNullable<LolState['active']>, s: LolState): string {
  const pts: string[] = [];
  const min = (s.gameTime || 0) / 60;
  const o = s.objectives || ({} as LolState['objectives']);
  const aram = !!s.isAram;
  const suporte = s.myRole === 'Suporte';
  const kp = s.score?.kp;

  if (kp != null) pts.push(`Você participou de ${kp}% dos abates do seu time.`);
  if ((a.kills + a.assists) > 0 && a.deaths > 0) {
    const kda = ((a.kills + a.assists) / a.deaths).toFixed(1);
    pts.push(`KDA de ${kda}.`);
  }
  // Morte só vira conselho quando se sabe COMO ela aconteceu.
  const m = s.mortes;
  if (m && m.total >= 4) {
    if (m.emNumero > m.duelo && m.emNumero >= 2) {
      pts.push(
        `Das suas ${m.total} mortes, ${m.emNumero} foram com dois ou mais inimigos em cima ` +
        'fora de luta: é falta de visão e de informação de mapa, não de calma.'
      );
    } else if (m.duelo >= 3) {
      pts.push(`Você perdeu ${m.duelo} confrontos diretos; escolha melhor os duelos.`);
    } else if (m.emLuta >= m.total / 2) {
      pts.push(`A maioria das suas ${m.total} mortes foi durante lutas coletivas — foque no seu posicionamento dentro da luta.`);
    }
    if (m.comOJunglerInimigo >= 2) {
      pts.push(`O jungler inimigo participou de ${m.comOJunglerInimigo} delas.`);
    }
  } else if (!m && a.deaths >= 8) {
    pts.push(`Foram ${a.deaths} mortes nesta partida.`);
  }

  if (!aram && !suporte && a.csPerMin) {
    if (a.csPerMin < 5 && min > 10) pts.push(`Farm baixo (${a.csPerMin} por minuto); busque seis ou mais.`);
    else if (a.csPerMin >= 7) pts.push(`Bom farm (${a.csPerMin} por minuto), continue assim.`);
  }
  if (!aram && o.towersAlly != null) {
    pts.push(`Seu time derrubou ${o.towersAlly} torres contra ${o.towersEnemy} do inimigo.`);
  }
  if (!aram && (o.dragonsAlly || 0) === 0 && min > 15) {
    pts.push('Seu time não pegou nenhum dragão; foque mais em objetivos neutros.');
  }
  if (!pts.length) pts.push('Partida equilibrada; mantenha a consistência.');
  return pts.join(' ');
}

/**
 * Monta o retrato honesto da partida para a IA.
 *
 * Cada número vem com NOME explícito e do lado certo (seu time x inimigo).
 * Antes daqui só ia "towers: 8" — o total dos DOIS times — e a análise saía
 * dizendo que você derrubou torres que na verdade perdeu.
 */
export function lolMatchPayload(state: LolState) {
  const a = state?.active || ({} as NonNullable<LolState['active']>);
  const o = state?.objectives || ({} as LolState['objectives']);
  const sc = state?.score || ({} as LolState['score']);
  const min = Math.max(1, Math.round((state?.gameTime || 0) / 60));
  return {
    modo: state?.mode || 'desconhecido',
    ehAram: !!state?.isAram,
    duracao: state?.clock || `${min} min`,
    duracaoEmMinutos: min,
    resultado: state?.result || 'desconhecido',
    voce: {
      campeao: a.champion || null,
      rota: state?.myRole || null,
      nivel: a.level ?? null,
      abates: a.kills ?? null,
      mortes: a.deaths ?? null,
      assistencias: a.assists ?? null,
      cs: a.cs ?? null,
      csPorMinuto: a.csPerMin ?? null,
      participacaoEmAbatesPct: sc.kp ?? null,
      itensNoFim: a.items || [],
      ouroNaoGastoNoFim: a.gold ?? null,
    },
    // O CONTEXTO das mortes. Sem isto só dá para contar mortes, e contar morte
    // sem saber o motivo vira julgamento errado.
    comoVoceMorreu: state?.mortes
      ? {
          total: state.mortes.total,
          emDuelo1x1: state.mortes.duelo,
          pegoPorDoisOuMais: state.mortes.emNumero,
          durandoLutaColetiva: state.mortes.emLuta,
          comOJunglerInimigoParticipando: state.mortes.comOJunglerInimigo,
          antesDosQuatorzeMinutos: state.mortes.naFaseDeRota,
          quemMaisTeMatou: state.mortes.quemMaisTeMatou,
        }
      : null,
    seuTime: {
      abates: sc.allyKills ?? null,
      torresQueDERRUBOU: o.towersAlly ?? null,
      dragoesQuePEGOU: o.dragonsAlly ?? null,
      quaisDragoes: o.dragonTypesAlly || [],
      baroesQuePEGOU: o.baronsAlly ?? null,
      arautosQuePEGOU: o.heraldsAlly ?? null,
      inibidoresQueDERRUBOU: o.inhibsAlly ?? null,
      jogadores: fichaDosJogadores(state?.allies, min),
    },
    timeInimigo: {
      abates: sc.enemyKills ?? null,
      torresQueDERRUBOU: o.towersEnemy ?? null,
      dragoesQuePEGOU: o.dragonsEnemy ?? null,
      quaisDragoes: o.dragonTypesEnemy || [],
      baroesQuePEGOU: o.baronsEnemy ?? null,
      inibidoresQueDERRUBOU: o.inhibsEnemy ?? null,
      jogadores: fichaDosJogadores(state?.enemies, min),
    },
    // O confronto que mais importa: você contra quem estava na sua cara.
    seuOponenteDireto: oponenteComparado(state, min),
  };
}

/** Ficha curta de cada jogador — permite comparar em vez de generalizar. */
function fichaDosJogadores(lista: RosterPlayer[] | undefined, minutos: number) {
  return (lista || []).map((p) => ({
    campeao: p.champion,
    rota: p.role || null,
    kda: `${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}`,
    cs: p.cs ?? null,
    csPorMinuto: p.cs != null && minutos > 0 ? Math.round((p.cs / minutos) * 10) / 10 : null,
  }));
}

/** Você x seu oponente de rota, lado a lado, com a diferença já calculada. */
function oponenteComparado(state: LolState, minutos: number) {
  const eu = (state?.allies || []).find((p) => p.isMe);
  const alvo = state?.opponent?.champion;
  const ele = (state?.enemies || []).find((p) => p.champion === alvo);
  if (!eu || !ele) return null;
  return {
    campeao: ele.champion,
    rota: ele.role || null,
    kdaDele: `${ele.kills ?? 0}/${ele.deaths ?? 0}/${ele.assists ?? 0}`,
    csDele: ele.cs ?? null,
    diferencaDeCs: eu.cs != null && ele.cs != null ? eu.cs - ele.cs : null,
    diferencaDeAbates: (eu.kills ?? 0) - (ele.kills ?? 0),
    csPorMinutoDele:
      ele.cs != null && minutos > 0 ? Math.round((ele.cs / minutos) * 10) / 10 : null,
  };
}

// Regras que valem para QUALQUER texto de treinador — é o que impede o
// Shadow de inventar torres, ganks e histórias que os dados não contam.
const REGRAS_HONESTAS = `
REGRAS INEGOCIÁVEIS:
- Use SOMENTE os números do JSON. Nunca invente abates, torres, dragões, ouro ou jogadas.
- "torresQueDERRUBOU" do seu time é o que VOCÊ e seus aliados destruíram. Nunca some com as do inimigo nem troque os lados.
- "ouroNaoGastoNoFim" é só o troco no bolso, NÃO é o ouro total da partida. Não comente sobre isso como se fosse renda.
- Se "resultado" for "desconhecido", não afirme vitória nem derrota: fale da partida sem citar o placar final.
- Se "ehAram" for verdadeiro: não fale de CS por minuto, farm de rota, selva, dragão, barão, recall para comprar nem oponente de rota. Nada disso existe no ARAM.
- Se a rota for "Suporte", não cobre CS; cobre visão, engajamento e proteção do carregador.
- Você NÃO tem visão do mapa. Nunca invente rotação, emboscada ou posição de ninguém.

SOBRE AS MORTES — leia com atenção, é onde mais se erra:
- NUNCA diga "posicionamento ruim", "excesso de agressividade" ou "se expôs" só porque o número de mortes é alto. Você não sabe o que aconteceu; quem jogou sabe, e vai perceber na hora que você está chutando.
- Use "comoVoceMorreu" para falar de morte. Ele separa os casos:
  · "emDuelo1x1" = perdeu confronto direto. SÓ aqui cabe falar de escolha de luta ou de trade.
  · "pegoPorDoisOuMais" = dois ou mais inimigos o pegaram fora de luta. Isso é gank/pick: fale de visão, de mapa, de não empurrar sem informação — NUNCA de "jogar menos agressivo".
  · "durandoLutaColetiva" = caiu em luta 5v5. Morrer em luta é parte do jogo; só vale comentar se for a maioria absoluta, e como foco/posicionamento NA luta.
- Se "comOJunglerInimigoParticipando" for alto, diga isso com o nome dele: é fato, não suposição.
- Se "comoVoceMorreu" for null, NÃO fale sobre o motivo das mortes. Cite o número e siga em frente.
- Não invente nomes de itens que não estejam em "itensNoFim" quando for falar do que ele comprou.
- Seja ESPECÍFICO: cite o número exato e de onde ele veio ("você 140 de CS contra 190 do Ezreal"), nunca uma impressão vaga.
- "diferencaDeCs" e "diferencaDeAbates" já são a sua conta pronta: positivo é a favor dele, negativo é contra. Não inverta.
- Se um campo for null ou uma lista vazia, o dado NÃO existe: não fale dele.`;

/**
 * Retrospecto pós-jogo: o que foi bem, o que errou e o que melhorar.
 * Usa o último estado válido da partida (a API cai quando o jogo acaba).
 */
export async function lolPostGame(state: LolState): Promise<string> {
  const a = state?.active;
  if (!a) return 'Não tenho dados suficientes dessa partida para analisar.';
  const base = ruleReview(a, state);
  if (!hasApiKey()) return base;

  const payload = lolMatchPayload(state);
  const sys =
    'Você é um treinador de League of Legends fazendo o RETROSPECTO de uma partida que ' +
    'acabou. Escreva em português do Brasil, para ser FALADO em voz alta: no máximo 4 ' +
    'frases, sem listas, sem markdown, sem emojis. Estrutura: (1) o que foi BEM, com o ' +
    'número que prova isso; (2) o principal ERRO, também com o número; (3) uma ou duas ' +
    'melhorias concretas para a próxima partida. Seja direto, específico e encorajador.' +
    REGRAS_HONESTAS;
  try {
    const res: any = await generate({
      model: config.model,
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
      config: { systemInstruction: sys, temperature: 0.5 },
    });
    return (res.text || '').trim() || base;
  } catch {
    return base; // se a IA falhar, o retrospecto por regras ainda vale
  }
}

/**
 * Refaz o retrospecto a partir dos números já guardados no histórico.
 * Serve depois de marcar vitória/derrota à mão ou quando a análise saiu ruim.
 */
export async function lolReanalyze(payload: unknown): Promise<string> {
  if (!hasApiKey()) throw new Error('Configure a chave do Gemini para refazer a análise.');
  const sys =
    'Você é um treinador de League of Legends fazendo o RETROSPECTO de uma partida que ' +
    'acabou. Escreva em português do Brasil, para ser FALADO em voz alta: no máximo 4 ' +
    'frases, sem listas, sem markdown, sem emojis. Estrutura: (1) o que foi BEM, com o ' +
    'número que prova isso; (2) o principal ERRO, também com o número; (3) uma ou duas ' +
    'melhorias concretas para a próxima partida. Traga um ângulo diferente do óbvio.' +
    REGRAS_HONESTAS;
  const res: any = await generate({
    model: config.model,
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
    config: { systemInstruction: sys, temperature: 0.7 },
  });
  const txt = (res.text || '').trim();
  if (!txt) throw new Error('A IA não devolveu análise.');
  return txt;
}

/**
 * Recomendação de build/counter contra o time inimigo, via Gemini.
 * Recebe seu campeão + rota e a composição inimiga (com o oponente de rota).
 */
export async function lolBuildAdvice(state: LolState): Promise<string> {
  if (!hasApiKey()) return 'Configure a chave do Gemini para receber builds.';
  const you = state?.active?.champion || 'seu campeão';
  const role = state?.myRole || state?.opponent?.role || '';
  const opp = state?.opponent?.champion;
  const enemies = (state?.enemies || []).map((e) => e.champion).filter(Boolean);
  const payload = {
    seuCampeao: you,
    suaRota: role,
    ehAram: !!state?.isAram,
    oponenteDeRota: state?.isAram ? null : opp || null,
    timeInimigo: enemies,
    seusItensAgora: state?.active?.items || [],
    tempoDeJogo: state?.clock || null,
  };
  const sys =
    'Você é um especialista em builds de League of Legends. Recebendo o seu campeão, ' +
    'sua rota, o oponente de rota e a composição inimiga, recomende de forma CURTA e ' +
    'FALADA (português do Brasil, no máx. 3 frases, sem listas nem markdown): ' +
    '1) 2 ou 3 itens-chave e por quê (ex.: armadura contra muito dano físico, ' +
    'resistência mágica contra dano mágico, anti-cura/Feridas Graves se houver cura, ' +
    'tenacidade contra muito controle de grupo); 2) um cuidado no confronto de rota ' +
    '(pule este item se "ehAram" for verdadeiro — no ARAM não existe rota). ' +
    'Seja prático e específico ao inimigo. Não repita itens que já estão em ' +
    '"seusItensAgora". Se faltar dado, use o que houver, sem inventar.';
  try {
    const res: any = await generate({
      model: config.model,
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
      config: { systemInstruction: sys, temperature: 0.5 },
    });
    return (res.text || '').trim() || 'Sem recomendação clara agora.';
  } catch (err) {
    const msg = String((err as any)?.message || err);
    if (isOverloadError(msg) || isQuotaError(msg)) {
      return 'O Gemini está ocupado agora. Tente a build de novo em instantes.';
    }
    return 'Não consegui montar a build agora.';
  }
}

/**
 * Dica avançada de League of Legends via Gemini, a partir do estado ao vivo.
 * Usada pelo botão "Dica do Shadow" no painel de jogo.
 */
export async function lolCoach(state: LolState): Promise<string> {
  if (!hasApiKey()) return 'Configure a chave do Gemini para receber dicas avançadas.';
  const a = state?.active || ({} as NonNullable<LolState['active']>);
  const o = state?.objectives || ({} as LolState['objectives']);
  // Só o que importa agora: mandar o estado inteiro (roster, dicas, itens de
  // todo mundo) só faz o modelo se perder e inventar.
  const agora: Record<string, unknown> = {
    ...lolMatchPayload(state),
    momento: {
      relogio: state?.clock,
      suaVidaPct: a.hpPct ?? null,
      voceEstaMorto: !!a.isDead,
      ouroNoBolsoAgora: a.gold ?? null,
      dragaoNasceEmSegundos: o.dragonIn ?? null,
      baraoNasceEmSegundos: o.baronIn ?? null,
      junglerInimigoMorto: state?.enemyJungler?.isDead ?? null,
    },
  };
  delete agora.resultado; // a partida não acabou
  const sys =
    'Você é um coach de League of Legends de alto nível, direto e prático. ' +
    'Receberá o estado ATUAL da partida em JSON. Dê UMA única orientação curta, ' +
    'específica e acionável em português do Brasil, para ser FALADA em voz alta: ' +
    'no máximo duas frases, sem listas, sem markdown, sem emojis. Foque em macro, ' +
    'farm, ouro e objetivos. Se estiver tudo bem, reforce o próximo objetivo.' +
    REGRAS_HONESTAS;
  try {
    const res: any = await generate({
      model: config.model,
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(agora) }] }],
      config: { systemInstruction: sys, temperature: 0.5 },
    });
    return (res.text || '').trim() || 'Sem uma dica clara agora. Continue no seu plano.';
  } catch (err) {
    const msg = String((err as any)?.message || err);
    if (isOverloadError(msg) || isQuotaError(msg)) {
      return 'O Gemini está ocupado agora. Tente a dica de novo em instantes.';
    }
    return 'Não consegui gerar a dica agora.';
  }
}
