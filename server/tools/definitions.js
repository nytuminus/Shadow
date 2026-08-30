import { Type } from '@google/genai';

/**
 * Declarações de funções (ferramentas) para o Gemini.
 * O modelo decide quando chamar cada uma; o servidor executa.
 * A busca na web (web_search) é tratada de forma especial: faz uma
 * chamada separada ao Gemini com o "Google Search" ativado.
 */
export const functionDeclarations = [
  {
    name: 'open_application',
    description:
      'Abre um programa/aplicativo no computador (Windows). Use para "abre o bloco de notas", "abrir a calculadora", "abre o Chrome", "abrir o Spotify".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Nome do app, ex.: "chrome", "bloco de notas", "calculadora", "spotify".',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'open_website',
    description:
      'Abre um site no navegador padrão, ou faz uma busca no Google se não for uma URL. Use para "abre o youtube", "abrir globo.com", "pesquisa gatos no google".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description: 'URL, apelido de site (ex.: "youtube") ou termo de busca.',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'open_folder',
    description:
      'Abre uma pasta no Explorador de Arquivos do Windows. Aceita atalhos como "downloads", "documentos", "área de trabalho" ou um caminho completo.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Nome-atalho da pasta ou caminho completo.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_reminder',
    description:
      'Cria um lembrete/alarme. Use para "me lembra de X em 10 minutos", "cria um lembrete para às 15:30 de ligar para a mãe".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: { type: Type.STRING, description: 'O que lembrar.' },
        when: {
          type: Type.STRING,
          description: 'Quando avisar, ex.: "em 10 minutos", "às 15:30", "amanhã às 8".',
        },
      },
      required: ['message', 'when'],
    },
  },
  {
    name: 'list_reminders',
    description: 'Lista os lembretes ativos do usuário.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'delete_reminder',
    description: 'Remove um lembrete pelo id (obtido em list_reminders).',
    parameters: {
      type: Type.OBJECT,
      properties: { id: { type: Type.STRING, description: 'Id do lembrete.' } },
      required: ['id'],
    },
  },
  {
    name: 'get_current_time',
    description: 'Retorna a data e a hora atuais.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'get_system_status',
    description:
      'Retorna o estado do computador AGORA: uso e temperatura de CPU e GPU, memória RAM, disco, bateria e tempo ligado. Use para "qual a temperatura do PC?", "como está o meu computador?", "quanto de RAM estou usando?".',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'get_weather',
    description:
      'Retorna o clima e a temperatura do TEMPO (ambiente/rua) na localização atual: temperatura, sensação, condição, umidade, vento, máxima e mínima. Use para "como está o tempo?", "qual a temperatura lá fora?", "vai chover hoje?".',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'spotify_play',
    description:
      'Toca uma música no Spotify. Se vier o nome de uma música/artista, procura e toca essa faixa; sem nome, apenas retoma a reprodução. Use para "toca Bohemian Rhapsody no Spotify", "coloca uma música do Coldplay", "continua a música".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Nome da música e/ou artista. Vazio para só retomar.' },
      },
    },
  },
  {
    name: 'spotify_control',
    description:
      'Controla a reprodução do Spotify. Use para "pausa a música", "próxima música", "música anterior", "voltar música".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Uma de: pause, next, previous, resume.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'spotify_volume',
    description: 'Ajusta o volume do Spotify (0 a 100). Use para "coloca o volume em 50", "aumenta o volume".',
    parameters: {
      type: Type.OBJECT,
      properties: { percent: { type: Type.NUMBER, description: 'Volume de 0 a 100.' } },
      required: ['percent'],
    },
  },
  {
    name: 'get_lol_status',
    description:
      'Retorna o estado da partida de League of Legends em andamento (tempo, seu campeão, KDA, CS, ouro, objetivos e uma dica). Use para "como está minha partida?", "o que eu faço agora no LoL?", "quanto tá o dragão?".',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'run_saved_command',
    description:
      'Executa um COMANDO SALVO do usuário pelo nome/gatilho (ex.: "modo trabalho", "modo jogo"). Use quando o usuário pedir para rodar/executar um atalho que ele mesmo criou.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        trigger: { type: Type.STRING, description: 'Nome do comando salvo, ex.: "modo trabalho".' },
      },
      required: ['trigger'],
    },
  },
  {
    name: 'web_search',
    description:
      'Pesquisa informações ATUAIS na web (notícias, clima, cotações, resultados, fatos recentes). Use sempre que a resposta depender de algo em tempo real.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'O que pesquisar, em linguagem natural.' },
      },
      required: ['query'],
    },
  },
];
