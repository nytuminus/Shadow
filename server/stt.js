// Transcrição de fala (STT) pelo Gemini.
//
// POR QUE ISTO EXISTE: no navegador, quem ouve é a Web Speech API do Chrome —
// de graça e instantânea. Só que ela usa um serviço do Google com uma chave
// embutida no Chrome, que o Electron NÃO tem: dentro do aplicativo instalado o
// reconhecimento sempre morre com o erro "network".
//
// Então, no modo aplicativo, o front grava trechos curtos de áudio e manda para
// cá; o Gemini devolve o texto e o resto do Shadow continua igual.

import { GoogleGenAI } from '@google/genai';
import { config, hasApiKey } from './config.js';
import { isQuotaError, isOverloadError, isDailyQuota } from './brain.js';

let _ai = null;
const getAI = () => (_ai ??= new GoogleGenAI({ apiKey: config.apiKey }));
export const resetSttAI = () => { _ai = null; };

// Transcrever é tarefa de modelo pequeno. Se ele estiver SOBRECARREGADO (503),
// vale tentar o modelo do cérebro; se for falta de COTA, não: cada frase falada
// passaria a comer a cota de pensar, e o Shadow ficaria burro para poder ouvir.
const MODELOS = [
  process.env.SHADOW_STT_MODEL || 'gemini-flash-lite-latest',
  config.model,
].filter((m, i, a) => m && a.indexOf(m) === i);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A palavra de ativação é o ponto fraco de transcrever: os modelos ouvem
// "Shadow" e escrevem "Cadê", "Gato", "Cadu". Se dependêssemos do texto, metade
// das chamadas se perderia — e forçar o modelo a escrever o nome fez ele ver o
// nome em qualquer ruído (o Shadow passou a responder sozinho).
//
// Solução: separar as duas perguntas. O texto sai fiel ao que foi dito, e
// "chamou" é um julgamento do MODELO sobre o ÁUDIO — que é quem tem a informação.
const INSTRUCAO =
  'Você recebe um trecho de áudio capturado pelo microfone de um assistente ' +
  `pessoal chamado "${config.assistantName}". Devolva dois campos:\n` +
  '1. "texto": a transcrição fiel do que foi falado, em português do Brasil, sem ' +
  'aspas, sem comentários, sem tradução e sem descrever sons. Não complete nem ' +
  'adivinhe palavras que não ouviu. Se for ruído, música, silêncio ou fala ' +
  'ininteligível, devolva string vazia.\n' +
  `2. "chamou": true SOMENTE se a pessoa chamou o assistente pelo nome ` +
  `("${config.assistantName}", ou uma pronúncia claramente parecida) para falar ` +
  'com ele. Na menor dúvida, false. Ruído, conversa entre outras pessoas, TV ao ' +
  'fundo e o próprio assistente falando são sempre false.\n' +
  `Se "chamou" for true e você tiver escrito o nome no texto, escreva-o como ` +
  `"${config.assistantName}".`;

// Formato fixo da resposta: sem isso o modelo às vezes devolve prosa.
const FORMATO = {
  type: 'object',
  properties: {
    texto: { type: 'string' },
    chamou: { type: 'boolean' },
  },
  required: ['texto', 'chamou'],
};

/**
 * @param {Buffer} audio  trecho de áudio (webm/opus, ogg ou mp4)
 * @param {string} mime   tipo do áudio enviado pelo navegador
 * @returns {Promise<{text: string, calledByName: boolean}>}
 */
export async function transcribe(audio, mime = 'audio/webm') {
  if (!hasApiKey()) throw new Error('Sem chave da API para transcrever.');
  if (!audio?.length) return { text: '', calledByName: false };

  const contents = [
    {
      role: 'user',
      parts: [
        { inlineData: { mimeType: mime.split(';')[0], data: audio.toString('base64') } },
        { text: INSTRUCAO },
      ],
    },
  ];

  // Uma tentativa por modelo; sobrecarga passa para o próximo em vez de
  // devolver erro para quem só quer ser ouvido.
  let ultimoErro;
  let res = null;
  for (const model of MODELOS) {
    let cotaAcabou = false;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        res = await getAI().models.generateContent({
          model,
          contents,
          config: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: FORMATO,
          },
        });
        break;
      } catch (err) {
        ultimoErro = err;
        const msg = String(err?.message || err);
        if (!isOverloadError(msg) && !isQuotaError(msg)) throw err;
        // Cota do dia acabou neste modelo: insistir só queima tempo.
        if (isQuotaError(msg) && isDailyQuota(msg)) { cotaAcabou = true; break; }
        await sleep(400 * (tentativa + 1));
      }
    }
    if (res) break;
    // Só passa para o modelo do cérebro quando o problema foi sobrecarga.
    if (cotaAcabou) break;
  }
  if (!res) throw ultimoErro || new Error('Falha ao transcrever.');

  let dados;
  try {
    dados = JSON.parse((res.text || '').trim());
  } catch {
    return { text: '', calledByName: false }; // resposta fora do formato: ignora
  }

  // Ainda limpamos aspas e o "(nada)" que às vezes escapa para dentro do campo.
  const texto = String(dados.texto || '').replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!texto || /^\(?\s*nada\s*\)?\.?$/i.test(texto)) {
    return { text: '', calledByName: false };
  }
  return { text: texto, calledByName: !!dados.chamou };
}
