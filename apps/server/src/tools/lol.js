// Modo Jogo — League of Legends ao vivo.
//
// Fonte: a Live Client Data API OFICIAL da Riot, que o próprio cliente do LoL
// serve localmente durante a partida em https://127.0.0.1:2999. Sem chave, sem
// hack, sem ler memória/tela — é o meio que a Riot disponibiliza para overlays.
//
// Limites HONESTOS da API (não dá para contornar de forma legítima):
//   - Só responde DENTRO de uma partida ativa (fora dela, conexão recusada).
//   - NÃO expõe posição no mapa nem visão -> nada de avisar gank/rotação.
//   - NÃO expõe cooldown de feiticeiro do inimigo.
// Por isso o "treinador" foca em farm, ouro, KDA, objetivos e timers.

import https from 'node:https';

const API = 'https://127.0.0.1:2999/liveclientdata/allgamedata';

// O cliente do LoL usa um certificado próprio (Riot). Ignoramos a verificação
// só para este host local e conhecido.
const agent = new https.Agent({ rejectUnauthorized: false });

function fetchGameData() {
  return new Promise((resolve, reject) => {
    const req = https.get(API, { agent, timeout: 2500 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`status ${res.statusCode}`));
      }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('resposta inválida')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Último estado válido em partida — usado para o retrospecto, já que a API
// para de responder assim que o jogo termina.
let lastInGame = null;
export const getLastInGame = () => lastInGame;
export const clearLastInGame = () => { lastInGame = null; };

// Eventos crus da última leitura. É a prova do que a Riot realmente manda —
// serve para conferir a atribuição de torres sem depender de adivinhação.
let ultimosEventos = [];
export function getLolDebug() {
  return {
    total: ultimosEventos.length,
    estruturas: ultimosEventos
      .filter((e) => /Turret|Inhib/i.test(e.EventName || ''))
      .map((e) => ({ evento: e, donoDetectado: structureOwner(e) })),
    outros: ultimosEventos
      .filter((e) => !/Turret|Inhib/i.test(e.EventName || ''))
      .map((e) => e.EventName),
  };
}

const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Casa o jogador ativo com a entrada dele em allPlayers (nome varia entre versões).
function findActive(active, players) {
  const names = [active?.summonerName, active?.riotIdGameName, active?.riotId]
    .filter(Boolean)
    .map((n) => String(n).toLowerCase());
  return players.find((p) => {
    const cand = [p.summonerName, p.riotIdGameName, p.riotId]
      .filter(Boolean)
      .map((n) => String(n).toLowerCase());
    return cand.some((c) => names.includes(c));
  });
}

const TEAM_PT = { ORDER: 'Azul', CHAOS: 'Vermelho' };

/** ARAM (e variantes) não tem rota, selva, dragão nem recall pra comprar. */
export const isAram = (mode) => /aram|howling/i.test(String(mode || ''));

// Tipos de dragão em português (o evento traz "Fire", "Earth", "Elder"…).
const DRAGAO_PT = {
  fire: 'Infernal',
  earth: 'Montanha',
  water: 'Oceano',
  air: 'Nuvem',
  hextech: 'Hextech',
  chemtech: 'Química',
  elder: 'Ancião',
};

const ROLE_PT = {
  TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte',
};

// Detecta o jungler pelo feitiço Punir (Smite). O rawDisplayName não é
// traduzido, então "SummonerSmite" aparece em qualquer idioma.
function hasSmite(player) {
  const sp = player.summonerSpells || {};
  const raws = [sp.summonerSpellOne, sp.summonerSpellTwo]
    .filter(Boolean)
    .map((s) => `${s.rawDisplayName || ''} ${s.displayName || ''}`.toLowerCase());
  return raws.some((r) => /smite|punir/.test(r));
}

// Rota do jogador: usa a posição informada; se vier vazia, ao menos marca o jungler.
function roleOf(player) {
  const pos = String(player.position || '').toUpperCase();
  if (ROLE_PT[pos]) return ROLE_PT[pos];
  if (hasSmite(player)) return 'Selva';
  return '';
}

function spellNames(player) {
  const sp = player.summonerSpells || {};
  return [sp.summonerSpellOne?.displayName, sp.summonerSpellTwo?.displayName].filter(Boolean);
}

/**
 * Devolve uma função nome→time. Os eventos usam o nome do invocador, que muda
 * de formato entre versões (summonerName, riotIdGameName, "Nome#TAG"), então
 * indexamos todas as variantes.
 */
function playerTeamLookup(players) {
  const mapa = new Map();
  for (const p of players) {
    for (const n of [p.summonerName, p.riotIdGameName, p.riotId]) {
      if (n) mapa.set(String(n).toLowerCase(), p.team);
    }
  }
  return (name) => {
    if (!name) return null;
    const k = String(name).toLowerCase();
    return mapa.get(k) || mapa.get(k.split('#')[0]) || null;
  };
}

/**
 * COMO você morreu, não só quantas vezes.
 *
 * Os eventos ChampionKill trazem quem matou e quem ajudou. Com isso dá para
 * separar o que é culpa de posicionamento do que é o jogo acontecendo:
 *
 *   - duelo:     um inimigo sozinho te matou (aí sim é confronto perdido)
 *   - emNumero:  dois ou mais te pegaram longe de qualquer luta (gank/pick)
 *   - emLuta:    você caiu durante uma luta coletiva (morrer ali é normal)
 *
 * Sem isso o treinador só sabia dizer "você morreu 11 vezes, jogue seguro" —
 * um julgamento que os dados não sustentam.
 *
 * @param {object[]} events   eventos da partida
 * @param {object[]} roster   jogadores com nome, time e função
 * @param {string} meuNome    nome do jogador ativo
 * @param {string} allyTeam   'ORDER' | 'CHAOS'
 */
export function analisarMortes(events, roster, meuNome, allyTeam) {
  const kills = (events || []).filter((e) => e.EventName === 'ChampionKill');
  const norm = (n) => String(n || '').toLowerCase().split('#')[0];
  const eu = norm(meuNome);
  const minhas = kills.filter((e) => norm(e.VictimName) === eu);

  const porNome = new Map();
  for (const p of roster || []) porNome.set(norm(p.name), p);
  const junglerInimigo = (roster || []).find((p) => p.team !== allyTeam && p.isJungler);

  const resumo = {
    total: minhas.length,
    duelo: 0,
    emNumero: 0,
    emLuta: 0,
    comOJunglerInimigo: 0,
    naFaseDeRota: 0, // antes dos 14 minutos
    quemMaisTeMatou: null,
    detalhe: [],
  };
  if (!minhas.length) return resumo;

  const contagemAlgoz = new Map();

  for (const morte of minhas) {
    const t = morte.EventTime || 0;
    const participantes = 1 + (morte.Assisters?.length || 0);

    // Havia luta acontecendo? Outros abates na mesma janela de tempo.
    const emVolta = kills.filter(
      (e) => e !== morte && Math.abs((e.EventTime || 0) - t) <= 10
    ).length;

    const envolvidos = [morte.KillerName, ...(morte.Assisters || [])].map(norm);
    const temJungler = !!junglerInimigo && envolvidos.includes(norm(junglerInimigo.name));

    let tipo;
    if (emVolta >= 1) tipo = 'emLuta';
    else if (participantes >= 2) tipo = 'emNumero';
    else tipo = 'duelo';

    resumo[tipo]++;
    if (temJungler) resumo.comOJunglerInimigo++;
    if (t < 14 * 60) resumo.naFaseDeRota++;

    const algoz = porNome.get(norm(morte.KillerName));
    const nomeAlgoz = algoz?.champion || morte.KillerName || '—';
    contagemAlgoz.set(nomeAlgoz, (contagemAlgoz.get(nomeAlgoz) || 0) + 1);

    resumo.detalhe.push({
      minuto: Math.floor(t / 60),
      tipo,
      inimigosEnvolvidos: participantes,
      matador: nomeAlgoz,
      comOJungler: temJungler,
    });
  }

  const maior = [...contagemAlgoz.entries()].sort((a, b) => b[1] - a[1])[0];
  if (maior && maior[1] > 1) resumo.quemMaisTeMatou = { campeao: maior[0], vezes: maior[1] };
  return resumo;
}

/**
 * Divide abates de objetivo (dragão, barão, arauto) entre os dois times,
 * pelo nome de quem matou.
 *
 * Quando o matador não bate com ninguém do placar, ele não entra em nenhum
 * lado — melhor um número faltando do que um número no time errado.
 */
export function creditByKiller(list, allyTeam, teamOf) {
  let ally = 0, enemy = 0, desconhecido = 0;
  for (const e of list) {
    const t = teamOf(e.KillerName);
    if (!t) { desconhecido++; continue; }
    if (t === allyTeam) ally++; else enemy++;
  }
  return { ally, enemy, desconhecido, total: list.length };
}

// Um time tem 11 torres (3 por rota + 2 do nexus) e 3 inibidores. Passar disso
// é prova de que a conta está errada — e é melhor dizer "não sei" do que mentir.
export const MAX_TORRES = 11;
export const MAX_INIBIDORES = 3;

/**
 * De quem ERA a estrutura derrubada.
 *
 * Procura o nome em qualquer campo do evento em vez de confiar numa chave fixa:
 * foi exatamente isso que quebrou antes — o campo não veio com o nome esperado,
 * toda torre caiu no mesmo balde e o histórico mostrou "0 × 16".
 *
 * @returns {'ORDER'|'CHAOS'|null} null quando o evento não diz.
 */
export function structureOwner(evento) {
  // Cuidado: o campo "EventName" vale "TurretKilled" — contém a palavra
  // "Turret" mas NÃO é o nome da estrutura. Por isso ele fica de fora e o
  // valor precisa ter a cara de um nome de verdade ("Turret_T1_C_05_A").
  const nome =
    Object.entries(evento || {}).find(
      ([chave, valor]) =>
        chave !== 'EventName' &&
        typeof valor === 'string' &&
        /^(turret|barracks|inhib)\w*_/i.test(valor)
    )?.[1] || '';
  if (/_T1\b|_T1_|order/i.test(nome)) return 'ORDER';
  if (/_T2\b|_T2_|chaos/i.test(nome)) return 'CHAOS';
  return null;
}

/**
 * Divide estruturas (torres, inibidores) entre os times.
 *
 * Primeiro pelo DONO da estrutura (quem perdeu a torre é o contrário de quem
 * derrubou); se o evento não disser, cai para o time de quem matou. O que não
 * der para saber fica em "desconhecido" — nunca é chutado para um dos lados.
 */
export function creditByStructure(list, allyTeam, teamOf = () => null) {
  let ally = 0, enemy = 0, desconhecido = 0;
  for (const e of list) {
    const dono = structureOwner(e);
    if (dono) {
      if (dono === allyTeam) enemy++; // era sua: quem derrubou foi o inimigo
      else ally++;
      continue;
    }
    const matador = teamOf(e.KillerName);
    if (matador) {
      if (matador === allyTeam) ally++; else enemy++;
      continue;
    }
    desconhecido++;
    if (desconhecido === 1) {
      console.warn('[lol] não consegui saber de quem era a estrutura:', JSON.stringify(e));
    }
  }
  return { ally, enemy, desconhecido, total: list.length };
}

/**
 * Última barreira: se a conta deu um número que o jogo não permite, ela está
 * errada em algum lugar — devolvemos null, e a tela e a IA tratam como "n/d".
 */
export function sanityCheck(split, maxPorTime) {
  const impossivel =
    split.ally > maxPorTime || split.enemy > maxPorTime || split.desconhecido > 0;
  if (!impossivel) return split;
  console.warn(
    `[lol] contagem impossível (${split.ally} × ${split.enemy}, ${split.desconhecido} sem dono, ` +
    `máximo ${maxPorTime} por time) — vou reportar como desconhecida.`
  );
  return { ...split, ally: null, enemy: null, confiavel: false };
}

/**
 * Lê o estado atual da partida e monta um resumo + dicas.
 * @returns {Promise<object>} { inGame:false } fora de partida.
 */
export async function getLolLive() {
  let data;
  try {
    data = await fetchGameData();
  } catch {
    return { inGame: false };
  }

  const gameTime = data.gameData?.gameTime || 0;
  const mode = data.gameData?.gameMode || '—';
  const players = Array.isArray(data.allPlayers) ? data.allPlayers : [];
  const events = data.events?.Events || [];
  ultimosEventos = events;
  const me = findActive(data.activePlayer, players);

  // ---- Objetivos (dragão/barão) a partir dos eventos ----
  const dragons = events.filter((e) => e.EventName === 'DragonKill');
  const barons = events.filter((e) => e.EventName === 'BaronKill');
  const heralds = events.filter((e) => e.EventName === 'HeraldKill');
  const towers = events.filter((e) => e.EventName === 'TurretKilled');
  const inhibs = events.filter((e) => e.EventName === 'InhibKilled');
  const lastDragon = dragons[dragons.length - 1];
  const lastBaron = barons[barons.length - 1];

  // Resultado, se o jogo já sinalizou o fim (evento GameEnd).
  const endEvent = events.find((e) => e.EventName === 'GameEnd');
  const result = endEvent
    ? endEvent.Result === 'Win' ? 'Vitória' : endEvent.Result === 'Lose' ? 'Derrota' : null
    : null;

  // Respawn: dragão 5:00 após a morte; barão 6:00.
  const dragonIn = lastDragon ? lastDragon.EventTime + 300 - gameTime : null;
  const baronIn = lastBaron ? lastBaron.EventTime + 360 - gameTime : null;

  // ---- Jogador ativo ----
  const myTeam = me?.team;
  const stats = data.activePlayer?.championStats || {};
  const cs = me?.scores?.creepScore ?? 0;
  const minutes = gameTime / 60;
  const csPerMin = minutes > 1 ? cs / minutes : 0;
  const gold = Math.round(data.activePlayer?.currentGold ?? 0);
  const hpPct = stats.maxHealth ? Math.round((stats.currentHealth / stats.maxHealth) * 100) : null;

  const active = me
    ? {
        champion: me.championName,
        level: me.level,
        kills: me.scores?.kills ?? 0,
        deaths: me.scores?.deaths ?? 0,
        assists: me.scores?.assists ?? 0,
        cs,
        csPerMin: Math.round(csPerMin * 10) / 10,
        gold,
        hpPct,
        isDead: !!me.isDead,
        respawnIn: me.isDead ? Math.round(me.respawnTimer || 0) : 0,
        team: myTeam,
        items: (me.items || []).map((i) => i.displayName),
      }
    : null;

  // ---- Placar por time ----
  const teamScore = (team) => {
    const t = players.filter((p) => p.team === team);
    const sum = (f) => t.reduce((a, p) => a + (p.scores?.[f] || 0), 0);
    return { kills: sum('kills'), deaths: sum('deaths'), assists: sum('assists') };
  };

  const meName = me?.riotIdGameName || me?.summonerName;
  const roster = players.map((p) => {
    const name = p.riotIdGameName || p.summonerName || '—';
    return {
      name,
      champion: p.championName,
      team: p.team,
      role: roleOf(p),
      isJungler: hasSmite(p),
      spells: spellNames(p),
      level: p.level,
      kills: p.scores?.kills ?? 0,
      deaths: p.scores?.deaths ?? 0,
      assists: p.scores?.assists ?? 0,
      cs: p.scores?.creepScore ?? 0,
      isDead: !!p.isDead,
      respawnIn: p.isDead ? Math.round(p.respawnTimer || 0) : 0,
      isMe: !!meName && name === meName,
    };
  });

  // Aliados x inimigos (do seu ponto de vista). Sem time definido, cai no ORDER/CHAOS.
  const allyTeam = myTeam || 'ORDER';
  const allies = roster.filter((p) => p.team === allyTeam);
  const enemies = roster.filter((p) => p.team !== allyTeam);
  const enemyJungler = enemies.find((p) => p.isJungler) || null;

  // Confronto de rota: mesmo papel no time inimigo (quando a rota é conhecida).
  const myRole = roster.find((p) => p.isMe)?.role;
  const opponent =
    (myRole && enemies.find((p) => p.role === myRole)) ||
    (roster.find((p) => p.isMe)?.isJungler && enemyJungler) ||
    null;

  // ---- Objetivos POR TIME ----------------------------------------------
  // Sem isto o retrospecto vira ficção: "towers" cru conta as torres dos DOIS
  // times, e a IA acaba dizendo que você derrubou o que na verdade perdeu.
  const teamOfPlayer = playerTeamLookup(players);
  const porMatador = (list) => creditByKiller(list, allyTeam, teamOfPlayer);

  // Todo objetivo passa pela mesma régua: ou o número fecha, ou é "n/d".
  const dragonSplit = sanityCheck(porMatador(dragons), 12);
  const baronSplit = sanityCheck(porMatador(barons), 10);
  const heraldSplit = sanityCheck(porMatador(heralds), 4);
  const towerSplit = sanityCheck(creditByStructure(towers, allyTeam, teamOfPlayer), MAX_TORRES);
  const inhibSplit = sanityCheck(creditByStructure(inhibs, allyTeam, teamOfPlayer), MAX_INIBIDORES);

  // Quais dragões cada lado pegou. "3 dragões" não diz nada; "Infernal,
  // Montanha e Elder do inimigo" muda completamente a leitura da partida.
  const tiposDeDragao = (meus) =>
    dragons
      .filter((e) => (teamOfPlayer(e.KillerName) === allyTeam) === meus)
      .map((e) => DRAGAO_PT[String(e.DragonType || '').toLowerCase()] || e.DragonType)
      .filter(Boolean);

  // Participação em abates: quanto do time passou pelas suas mãos.
  const allyKills = allies.reduce((soma, p) => soma + (p.kills || 0), 0);
  const enemyKills = enemies.reduce((soma, p) => soma + (p.kills || 0), 0);
  const kp =
    active && allyKills > 0
      ? Math.round(((active.kills + active.assists) / allyKills) * 100)
      : null;

  const state = {
    inGame: true,
    mode,
    isAram: isAram(mode),
    myRole: myRole || null,
    gameTime: Math.round(gameTime),
    clock: fmtTime(gameTime),
    active,
    teams: {
      order: { ...teamScore('ORDER'), label: TEAM_PT.ORDER },
      chaos: { ...teamScore('CHAOS'), label: TEAM_PT.CHAOS },
    },
    score: {
      allyKills,
      enemyKills,
      diff: allyKills - enemyKills,
      kp, // % de participação nos abates do seu time
    },
    // Como você morreu — o que separa "posicionamento ruim" de "te pegaram".
    mortes: analisarMortes(events, roster, meName, allyTeam),
    objectives: {
      // Totais dos DOIS times (compatibilidade com a tela antiga)…
      dragons: dragonSplit.total,
      barons: baronSplit.total,
      towers: towerSplit.total,
      // …e o que realmente importa: quem fez cada coisa.
      dragonsAlly: dragonSplit.ally,
      dragonsEnemy: dragonSplit.enemy,
      dragonTypesAlly: tiposDeDragao(true),
      dragonTypesEnemy: tiposDeDragao(false),
      baronsAlly: baronSplit.ally,
      baronsEnemy: baronSplit.enemy,
      heraldsAlly: heraldSplit.ally,
      heraldsEnemy: heraldSplit.enemy,
      towersAlly: towerSplit.ally,
      towersEnemy: towerSplit.enemy,
      inhibsAlly: inhibSplit.ally,
      inhibsEnemy: inhibSplit.enemy,
      dragonIn: dragonIn != null ? Math.round(dragonIn) : null,
      baronIn: baronIn != null ? Math.round(baronIn) : null,
    },
    roster,
    allies,
    enemies,
    enemyJungler: enemyJungler
      ? { champion: enemyJungler.champion, isDead: enemyJungler.isDead, respawnIn: enemyJungler.respawnIn }
      : null,
    opponent: opponent ? { champion: opponent.champion, role: opponent.role } : null,
    result,
  };

  state.tips = buildTips(state);
  lastInGame = state; // guardamos para o retrospecto pós-jogo
  return state;
}

// ---- Treinador baseado em regras (instantâneo, sem gastar cota) ----
// Cada dica tem um `id` estável: o front fala só quando a dica é nova.
function buildTips(s) {
  const tips = [];
  const a = s.active;
  const min = s.gameTime / 60;
  // No ARAM não existe recall pra comprar, selva, dragão nem farm de rota —
  // dica de CS ali é a receita certa para o Shadow falar bobagem.
  const aram = isAram(s.mode);

  if (!a) return tips;

  if (a.isDead) {
    tips.push({ id: 'dead', level: 'info', text: `Você está morto, volta em ${a.respawnIn}s. Planeje a próxima jogada.` });
    return tips; // morto: nada de recall/farm agora
  }

  // Vida baixa
  if (a.hpPct != null && a.hpPct <= 20) {
    tips.push({ id: 'lowhp', level: 'urgent', text: `Vida em ${a.hpPct}%. Recue agora.` });
  }

  // Ouro para voltar
  if (!aram && a.gold >= 1300) {
    tips.push({ id: 'recall', level: 'warn', text: `Você tem ${a.gold} de ouro. Considere voltar pra comprar.` });
  }

  // Farm abaixo do esperado (referência ~7 CS/min é bom; abaixo de 5 é fraco).
  // Suporte vive de outro jeito: cobrar CS dele seria conselho errado.
  if (!aram && s.myRole !== 'Suporte' && min >= 8 && a.csPerMin > 0 && a.csPerMin < 5) {
    tips.push({ id: 'farm', level: 'warn', text: `Seu CS está baixo, ${a.csPerMin} por minuto. Foque em farmar.` });
  }

  // Mortes: a dica muda conforme COMO você está morrendo. Mandar "jogue mais
  // seguro" para quem está sendo pego em número é conselho errado.
  const m = s.mortes;
  if (m && m.total >= 3) {
    if (m.emNumero >= 2 && m.emNumero > m.duelo) {
      tips.push({
        id: 'mortes-gank-' + m.emNumero,
        level: 'warn',
        text:
          `Já foram ${m.emNumero} mortes com dois ou mais em cima de você fora de luta. ` +
          'Peça visão antes de empurrar e evite ficar sozinho nas laterais.',
      });
    } else if (m.duelo >= 3) {
      tips.push({
        id: 'mortes-duelo-' + m.duelo,
        level: 'warn',
        text: `Você já perdeu ${m.duelo} duelos diretos. Evite os confrontos um contra um até ganhar itens.`,
      });
    }
    if (m.comOJunglerInimigo >= 2 && s.enemyJungler) {
      tips.push({
        id: 'jungler-em-cima-' + m.comOJunglerInimigo,
        level: 'urgent',
        text: `O ${s.enemyJungler.champion} já participou de ${m.comOJunglerInimigo} das suas mortes. Ele está te caçando: jogue mais perto da torre.`,
      });
    }
  } else if (!m && a.deaths >= 4 && a.deaths > a.kills + a.assists) {
    tips.push({ id: 'deaths', level: 'info', text: `Você já morreu ${a.deaths} vezes nesta partida.` });
  }

  // Nível 6 (ultimate)
  if (a.level >= 6 && a.level < 7) {
    tips.push({ id: 'ult6', level: 'info', text: 'Você tem seu ultimate no nível 6. Procure uma boa jogada.' });
  }

  // "Radar de perigo" honesto: baseado no ESTADO do jungler inimigo, não em visão.
  const ejg = s.enemyJungler;
  if (ejg) {
    if (ejg.isDead) {
      tips.push({
        id: 'ejg-dead',
        level: 'warn',
        text: `Jungler inimigo (${ejg.champion}) está morto por ~${ejg.respawnIn}s. Empurre e faça objetivos em segurança.`,
      });
    }
  }

  // Objetivos (não existem no ARAM)
  const o = s.objectives;
  if (aram) return tips;
  if (o.dragonIn != null && o.dragonIn <= 0) {
    tips.push({ id: 'dragon-up-' + o.dragons, level: 'warn', text: 'Dragão disponível. Ganhe visão e agrupe.' });
  } else if (o.dragonIn != null && o.dragonIn <= 30) {
    tips.push({ id: 'dragon-soon-' + o.dragons, level: 'info', text: `Dragão nasce em ${o.dragonIn}s. Prepare a área.` });
  }
  if (o.baronIn != null && o.baronIn <= 0 && s.gameTime >= 1200) {
    tips.push({ id: 'baron-up-' + o.barons, level: 'warn', text: 'Barão disponível. Cuidado ao contestar sem visão.' });
  }

  // Leitura do placar de objetivos — agora que sabemos de quem é cada um.
  if (o.dragonsEnemy >= 2 && o.dragonsEnemy > o.dragonsAlly) {
    tips.push({
      id: 'dragao-atras-' + o.dragonsEnemy,
      level: o.dragonsEnemy >= 3 ? 'urgent' : 'warn',
      text:
        o.dragonsEnemy >= 3
          ? `O inimigo está com ${o.dragonsEnemy} dragões e fecha a alma no próximo. Esse você precisa contestar.`
          : `O inimigo tem ${o.dragonsEnemy} dragões contra ${o.dragonsAlly} seus. Prepare visão para o próximo.`,
    });
  }
  if (o.towersEnemy - o.towersAlly >= 3) {
    tips.push({
      id: 'torres-atras-' + o.towersEnemy,
      level: 'warn',
      text: `Vocês perderam ${o.towersEnemy} torres e derrubaram ${o.towersAlly}. Jogue mais perto das suas e limpe as ondas.`,
    });
  }

  return tips;
}

/** Resumo curto para o Shadow falar quando perguntam da partida. */
export async function getLolSummary() {
  const s = await getLolLive();
  if (!s.inGame) return 'Você não está em uma partida de League of Legends agora.';
  const a = s.active;
  if (!a) return `Partida em andamento, ${s.clock} de jogo.`;
  let txt = `Aos ${s.clock}, você está de ${a.champion}, nível ${a.level}, com ${a.kills}/${a.deaths}/${a.assists} e ${a.cs} de CS.`;
  if (s.tips.length) txt += ' ' + s.tips[0].text;
  return txt;
}
