# SHADOW ⚡

Seu assistente pessoal por voz, com o cérebro do **Google Gemini** (grátis).
Fala e ouve em **português**, executa ações no seu PC, pesquisa na web e gerencia lembretes — numa interface HUD roxa estilo reator arc. O microfone fica **sempre aberto** e ele só age quando você chama pelo nome: **"Shadow"**.

A voz dele é **neural** (gerada pelo Gemini), com entonação humana — não é a voz sintética do Windows.

O Shadow agora é uma **plataforma unificada**: ao abrir (`/`), há um **dock de
módulos** à esquerda — **🤖 Shadow** (o assistente), **🎮 Jogos** (o Modo Jogo
do LoL) e **💬 Salas** (chamadas de voz/vídeo/tela + chat da equipe). A
**chamada não cai ao trocar de módulo**: vira um **pod flutuante arrastável**,
então dá pra usar o robô ou acompanhar o jogo sem sair da call.

---

## 💬 Salas (plataforma da equipe)

Feita em **React + TSX** (código em `web/`, build em `public/salas`). O shell
da plataforma é servido em **`/`**; o app do assistente (voz, LoL, monitor)
continua inteiro e é embutido como módulo em **`/assistant`** (iframe, mesmo
domínio). A chamada roda no nível do shell — por isso persiste como pod
flutuante enquanto você navega entre Shadow, Jogos e Salas.

- **Salas** (como servidores do Discord) → cada uma com **canais de texto** e
  **canais de voz**.
- **Canais de voz**: entram vários, com **microfone, câmera e tela
  compartilhada**. A conexão de áudio/vídeo é **peer-to-peer** (WebRTC em
  malha); o servidor só apresenta os participantes.
- **Chat de texto** por canal, em tempo real, com histórico salvo.

### Rodar / desenvolver

```bash
npm install            # dependências do motor (inclui ws, mysql2)
npm run salas:install  # dependências do frontend React (uma vez)
npm run salas:build    # gera o build em public/salas
npm start              # sobe o motor; Salas ficam em http://localhost:4577/salas
npm run salas:dev      # (opcional) frontend em modo dev, com hot-reload
```

### Banco de dados (trocável)

Por padrão as Salas gravam num **arquivo local** (`server/data/community.json`)
e já funcionam. Para produção/multiusuário, preencha as variáveis **`MYSQL_*`**
(ou `DATABASE_URL`) no `.env` apontando para o **MySQL da Hostinger** — o
código detecta e migra sozinho as tabelas (`server/db/`). Nada nas rotas muda:
o adaptador é intercambiável.

### Chamadas pela internet (entre pessoas em lugares diferentes)

Duas coisas são necessárias além do que já está pronto:
1. **HTTPS** — navegadores só liberam microfone/câmera/tela em contexto
   seguro (ou em `localhost`). Ao publicar, sirva por HTTPS.
2. **Servidor TURN** — para atravessar firewalls/NAT entre redes diferentes.
   Suba um `coturn` (ex.: na VPS da Hostinger) e preencha `TURN_URL`,
   `TURN_USERNAME`, `TURN_CREDENTIAL` no `.env`.

---

## 🚀 Como usar (rápido)

1. **Configure a chave da API** (veja a seção abaixo — é o único passo obrigatório).
2. Dê **dois cliques em `Shadow.bat`**.
   - Na primeira vez ele instala tudo sozinho (pode demorar 1–2 min).
   - Depois abre a janela do Shadow automaticamente.
3. Clique **uma vez** no **botão do microfone** (ou aperte a **barra de espaço**) para **ativar a escuta**. Permita o microfone.
4. A partir daí é só falar chamando pelo nome: **"Shadow, abre o Chrome"**, **"Shadow, que horas são?"**.
   - Se disser só **"Shadow"**, ele responde e espera o seu comando.
   - Também dá pra **digitar** o comando no campo de baixo (aí não precisa dizer "Shadow").
5. Para **desligar**, feche a janela preta do "Motor".

> Dica: crie um atalho de `Shadow.bat` na sua Área de Trabalho para abrir com um clique.
> (O antigo `Jarvis.bat` continua funcionando — ele só chama o `Shadow.bat`.)

---

## 💾 Instalar como aplicativo (em vez de abrir no navegador)

O Shadow também é um **app de desktop de verdade** (Electron): ícone próprio,
janela sem barra de navegador, ícone na bandeja ao lado do relógio e **nenhuma
necessidade de ter o Node.js instalado** no PC que for usar.

```bash
npm install      # só na primeira vez
npm run app      # abre o app (modo teste, sem instalar)
npm run dist     # gera o instalador
```

O instalador sai em **`instalador/Shadow Setup <versão>.exe`**. Instale e pronto:
o Shadow vira um programa normal do Windows, com atalho na Área de Trabalho e no
menu Iniciar.

Detalhes de como ele se comporta como app:

- **Fechar no X** manda o Shadow para a **bandeja** — ele continua ouvindo. Para
  encerrar de vez, clique com o botão direito no ícone da bandeja e escolha **Sair**.
- O motor sobe junto com o app; se já houver um motor rodando (pelo `Shadow.bat`),
  ele reaproveita em vez de abrir outro.
- A chave da API pode ficar no `.env` da pasta do programa **ou** em
  `%APPDATA%\Shadow\.env` — assim ela sobrevive a uma atualização do app. Se faltar,
  dá para **colar a chave direto na tela**: o aviso vermelho tem um campo, e ela
  passa a valer na hora, sem reiniciar.
- Seus dados (lembretes, comandos salvos, histórico de partidas e a sessão do
  Spotify) ficam em **`%APPDATA%\Shadow\data`**, fora da pasta do programa — uma
  atualização não leva nada junto. Na primeira execução ele traz o que já existia.
- **Se o motor cair**, o app percebe, reabre sozinho e recarrega a tela. Antes a
  janela ficava viva com o motor morto e tudo respondia "Failed to fetch".

### 🎙️ Como o microfone funciona no app

Isto é importante: a escuta do navegador (**Web Speech API**) usa um serviço do
Google com uma chave embutida no Chrome — que o **Electron não tem**. Dentro do
aplicativo ela sempre falha com o erro `network`. Por isso, no modo app o Shadow usa
outro caminho:

1. Grava o trecho enquanto você fala (ele detecta sozinho quando você começa e para,
   pelo volume do microfone, com o gravador já rodando para não cortar a primeira sílaba).
2. Manda o áudio para `/api/stt`, onde o **Gemini transcreve**.
3. O texto entra no mesmo fluxo de sempre — inclusive a palavra de ativação.

Consequências práticas: cada frase falada gasta uma chamadinha da cota do Gemini, e o
texto demora ~1–3 s a mais que no navegador. Em compensação a transcrição é **melhor**
que a do Chrome, e ela já sabe que o assistente se chama "Shadow" — some aquele
problema de ele entender "chadou/xadu" e não responder.

No **modo navegador** nada disso muda: continua usando a escuta nativa, de graça e
instantânea. Se ela falhar (sem internet no serviço de voz), o Shadow migra sozinho
para a transcrição pelo Gemini e avisa na tela.

### 🚀 Iniciar junto com o Windows

No painel **Controles → Aplicativo**, marque **"Iniciar com o Windows"**.

- **No app instalado:** ele passa a abrir sozinho, direto na bandeja (sem janela na cara).
- **No modo navegador:** o Shadow cria um atalho na pasta **Inicializar** do Windows
  apontando para o `Shadow.bat`, iniciado minimizado. Desmarcar remove o atalho.

---

## 🗯️ O bordão

Sempre que você perguntar se ele está aí, a resposta é sempre a mesma:

| Você diz | Ele responde |
|---|---|
| "Shadow?" | **"O que é, desgraça?"** |
| "Você tá aí?" | **"O que é, desgraça?"** |
| "Cadê você?" / "Tá me ouvindo?" / "Tá acordado?" | **"O que é, desgraça?"** |

Isso é respondido pelo motor local na hora — nem consulta o Gemini, nem gasta cota.
Para trocar a frase, mude `SHADOW_CATCHPHRASE` no `.env`.

---

## 🔊 A voz

O Shadow fala por três motores, e você escolhe no painel **"Voz"**, à direita:

| Motor | Como soa | Velocidade | Custo |
|---|---|---|---|
| **Local (rápida)** — padrão | Voz neural baixada, roda no seu PC | **~0,3 s** | grátis, ilimitada, funciona offline |
| **Gemini (máxima)** | A mais bonita: entonação e ritmo de gente | ~3 s | usa a cota do Gemini |
| **Navegador** | Voz do Windows/Edge | imediata | grátis e ilimitada |

**A voz local** fica na pasta `voz-local` (Piper + a voz `pt_BR-faber-medium`, ~98 MB).
Ela é o padrão porque é **10× mais rápida** que a do Gemini: o modelo é carregado uma
vez quando o motor liga e cada frase sai em fração de segundo, sem internet.

**A voz do Gemini** é mais expressiva — use se preferir qualidade a velocidade. São 12
timbres; o padrão é **Charon** (grave e firme). Vale testar **Algenib** (rouca),
**Enceladus** (baixa, quase sussurrada) e **Orus** (firme). O seletor de timbre só
aparece quando esse motor está escolhido.

Clique em **"Testar voz"** para ouvir antes de decidir. A etiqueta ao lado de "Voz"
mostra qual motor falou por último.

**Nunca fica mudo:** se o motor escolhido falhar, ele tenta o outro e, por último, a
voz do navegador. Por isso a janela abre no **Edge** — é o único navegador que traz a
voz neural da Microsoft (**Francisca Online (Natural)**, marcada com ★). No Chrome a
última reserva seriam as vozes antigas (Daniel/Maria), que soam robóticas.

Frases repetidas ficam em **cache** (`server/data/tts-cache`) e saem instantâneas — o
bordão, por exemplo, já vem pronto.

### 🔉 Volume

No card **Voz** tem uma barra de **volume** (e um botão para silenciar num clique).
O mesmo controle está **no rodapé**, ao lado da caixa de digitar, para você abaixar o
Shadow sem procurar nada — inclusive **no meio de uma frase**, que o volume muda na hora.
O valor fica guardado para a próxima vez que você abrir.

Ao lado de "Testar voz" existe o **🔊 Ouvir de novo**: repete a última coisa que ele falou
(útil quando você perde o começo da resposta).

---

## 🔑 A chave da API — o que é e como pegar (GRÁTIS)

O Shadow usa o **Google Gemini** para pensar e para falar. Ele precisa de uma **chave
de API** — uma senha secreta que autoriza o app a conversar com o Gemini. A boa
notícia: no Google AI Studio a chave é **gratuita e não pede cartão de crédito**.

**Passo a passo:**

1. Acesse **https://aistudio.google.com/apikey** e entre com sua conta Google.
2. Clique em **Create API key** (Criar chave de API).
3. **Copie a chave** (costuma começar com `AIza...`).
4. Na pasta do Shadow, abra o arquivo **`.env`** (se não existir, rode o `Shadow.bat`
   uma vez que ele cria) e cole:

   ```
   GEMINI_API_KEY=AIza-cole-sua-chave-aqui
   ```

5. Salve e reabra o `Shadow.bat`. Pronto — o Shadow está vivo.

> **Segurança:** a chave fica só no seu PC, no arquivo `.env` (que não é
> compartilhado). Nunca a mostre para ninguém nem a suba para a internet.

---

## 🗣️ O que você pode pedir

| Você diz | O Shadow faz |
|---|---|
| "Você tá aí?" | "O que é, desgraça?" |
| "Que horas são?" / "Que dia é hoje?" | Responde na hora |
| "Abre o Chrome" / "Abrir a calculadora" | Abre o programa |
| "Abre o YouTube" / "Pesquisa gatos no Google" | Abre o site / a busca |
| "Abre a pasta downloads" | Abre no Explorador de Arquivos |
| "Quais as notícias de hoje?" / "Como está o dólar?" | Pesquisa na web e resume |
| "Me lembra de beber água em 30 minutos" | Cria um lembrete com alarme |
| "Quais meus lembretes?" | Lista os lembretes ativos |
| Qualquer conversa | Ele responde como um assistente |

> Basta começar cada pedido com **"Shadow"**. Ele fica ouvindo o tempo todo, mas só
> responde quando você chama pelo nome. Se quiser que ele responda a **qualquer** fala
> (sem precisar dizer "Shadow"), desmarque **"Exigir Shadow"** no canto inferior direito.

---

## 🎮 Modo Jogo (League of Legends)

O botão com a **logo do LoL**, no rodapé, abre uma **tela dedicada só ao jogo**: os
painéis de conversa, sistemas e controles saem de cena e o deck ocupa tudo. Para
sair, clique em **✕ Sair**, aperte **Esc** ou clique na logo de novo.

A tela é dividida em três colunas:

| Coluna | O que traz |
|---|---|
| **Times** | Os dois times **separados**, cada jogador com rota, campeão, **KDA e CS**, quem está morto, o jungler e o seu oponente direto marcado |
| **Centro** | Objetivos (seus × deles), o **treinador** com os botões de IA, e os **gráficos** da partida |
| **Lado** | **Desempenho do PC** (FPS, CPU, GPU, VRAM, RAM, temperatura) e o histórico |

**Gráficos** (desenhados em SVG, sem biblioteca externa — funciona offline):
abates do seu time × inimigos ao longo do tempo, seu CS × o do oponente de rota,
barras de objetivos por time e participação em abates de cada jogador. A API da Riot
só entrega o instante atual, então o Shadow guarda cada leitura para poder desenhar a
evolução.

Os dados vêm da **Live Client Data API oficial da Riot** (`127.0.0.1:2999`), que o
próprio cliente do LoL publica durante o jogo — sem chave, sem ler tela nem memória.

### 📈 FPS

O medidor de FPS mostra o número **real**, medido quadro a quadro — quando o
**PresentMon** estiver disponível. Motivo: nem a API da Riot nem o Windows entregam
os quadros por segundo de outro programa; isso só sai pelo ETW do Windows, que é o
que o PresentMon lê (o mesmo motor do CapFrameX e do FrameView).

Para ligar, veja **[ferramentas/LEIA-ME.txt](ferramentas/LEIA-ME.txt)**: baixe o
`PresentMon.exe`, coloque em `%APPDATA%\Shadow\ferramentas` e abra o Shadow como
administrador. Sem ele, o FPS aparece como **n/d** — de propósito. CPU, GPU, VRAM,
RAM e temperatura funcionam sempre, e são elas que explicam a maioria dos travamentos.

**O que ele mostra:** seu KDA, CS, ouro, vida, **participação nos abates** e, para
cada objetivo, **o seu lado × o do inimigo** — torres, dragões (com o tipo de cada
um), barões e inibidores. O placar é rotulado "Seu time × Inimigos" em vez de
azul/vermelho, e cada jogador dos dois times aparece com **KDA e CS**, para você
comparar com quem estava na sua rota.

> Por que isso importa: antes cada objetivo mostrava o **total somado dos dois
> times** ("8 torres"), o que fazia parecer que o seu time estava dominando quando
> na verdade tinha derrubado 2 e perdido 6 — e a IA repetia essa conta errada.

### 💀 Por que você morreu (não só quantas vezes)

Contar mortes é fácil e leva a conselho errado: "você morreu 11 vezes, jogue mais
seguro" é um julgamento que os dados não sustentam — talvez tenha sido gank, talvez
luta 5v5, talvez duelo perdido mesmo.

Os eventos `ChampionKill` da Riot trazem **quem matou e quem ajudou**. Com isso o
Shadow separa cada morte sua em três casos:

| Caso | O que significa | Conselho que cabe |
|---|---|---|
| **Duelo 1x1** | um inimigo sozinho te matou | escolha de confronto, trade |
| **Pego em número** | dois ou mais te pegaram **fora** de luta | visão, mapa, não empurrar sem informação |
| **Em luta coletiva** | caiu durante uma luta | posicionamento **dentro** da luta |

Ele também conta quantas tiveram o **jungler inimigo** participando e quantas foram
antes dos 14 minutos. O prompt da IA proíbe explicitamente falar de "posicionamento
ruim" ou "agressividade demais" sem esse dado — e, se ele não existir (partidas
antigas), ela cita o número de mortes e não inventa o motivo.

**Números impossíveis nunca aparecem.** Um time tem no máximo 11 torres e 3
inibidores; se a conta passar disso, ou se alguma estrutura ficar sem dono, o
Shadow mostra **n/d** em vez de inventar — e a IA não fala do que está como n/d.
Foi assim que se descobriu o bug antigo: o histórico mostrava "0 × 16", e 16
torres de um lado só não existe. Partidas gravadas antes disso são corrigidas
sozinhas e ganham um aviso sugerindo **Refazer análise**.

Para conferir com dados reais: com uma partida rodando, abra
`http://localhost:4577/api/lol/debug` — ele mostra os eventos crus da Riot e de
quem o Shadow achou que era cada estrutura.

**O que ele NÃO consegue** (limite honesto da API, não dá para contornar): posição no
mapa, visão e cooldown de feitiço do inimigo. Por isso ele **nunca avisa gank** — se
avisasse, estaria inventando.

### Fim de jogo e histórico

Quando a partida acaba, o Shadow gera um **retrospecto** falado e guarda no histórico,
com o resumo de vitórias, KDA médio e participação média.

Em cada partida do histórico você tem:

| Botão | O que faz |
|---|---|
| **🔊 Ouvir de novo** | Lê a análise daquela partida em voz alta (clique de novo para parar) |
| **♻️ Refazer análise** | Gera outro retrospecto com os mesmos números, por outro ângulo |
| **Vitória / Derrota** | Aparece quando o jogo fechou antes da última leitura e o placar ficou "n/d" |
| **✕** | Apaga o registro |

Dentro da partida também há **🔊 Ouvir de novo** e **⏹ Parar fala**.

### Por que as análises agora fazem sentido

Antes, o retrospecto recebia só o número **somado dos dois times** (ex.: "8 torres") e
a IA acabava dizendo que *você* derrubou tudo. Agora cada número vai **separado por
time e com nome explícito** (`torresQueDERRUBOU` do seu time × do inimigo), e o prompt
tem regras duras: não inventar números, não afirmar vitória quando o resultado é
desconhecido, não falar de CS/rota/dragão em **ARAM** e não cobrar farm de **suporte**.

---

## ⚙️ Ajustes (arquivo `.env`)

```
GEMINI_API_KEY=...                    # sua chave do Google Gemini (obrigatório)
JARVIS_MODEL=gemini-flash-latest      # modelo do cérebro (veja abaixo)
SHADOW_FALLBACK_MODEL=gemini-flash-lite-latest  # reserva quando a cota do dia acaba
SHADOW_STT_MODEL=gemini-flash-lite-latest       # transcreve sua voz no modo app
ASSISTANT_NAME=Shadow                 # nome do assistente e palavra de ativação
SHADOW_CATCHPHRASE=O que é, desgraça? # resposta fixa do "você tá aí?"
SHADOW_ENGINE=local                   # motor de voz padrão: local ou gemini
SHADOW_LOCAL_VOICE=pt_BR-faber-medium # voz baixada, na pasta voz-local
SHADOW_LOCAL_RATE=0.98                # velocidade da voz local (menor = mais rápido)
SHADOW_VOICE=Charon                   # timbre da voz do Gemini
SHADOW_TTS=on                         # "off" desliga a voz do Gemini
PORT=4577                             # porta do motor local (não precisa mudar)
JARVIS_USER_NAME=desgraça             # como ele te chama
```

> Quer mudar o nome dele? Troque `ASSISTANT_NAME` — a palavra de ativação passa a ser
> o novo nome, e o título da janela acompanha.

**Modelos** (troque `JARVIS_MODEL` para mudar):
- `gemini-flash-latest` — sempre o Flash mais atual (padrão, recomendado).
- `gemini-3.5-flash` — uma versão específica e estável.
- `gemini-3.1-flash-lite` — mais leve e econômico.

---

## 🧩 Requisitos

- **Windows 10/11**
- **Node.js** instalado (você já tem). Baixe em https://nodejs.org se precisar.
- **Microsoft Edge** (recomendado) ou **Google Chrome**.
- Conexão com a internet.

---

## 🐢 "Ele ficou lento"

Quase sempre é **cota do plano grátis**, não o seu PC. Cada modelo do Gemini tem
uma cota **por minuto** e outra **por dia**. Quando a diária acaba, a API recusa
tudo daquele modelo até a virada do dia.

O Shadow lida com isso assim:

- **Limite por minuto:** tenta o outro modelo na hora; só espera se os dois recusarem.
- **Limite do dia:** aposenta o modelo até o próximo reset e passa para o
  `SHADOW_FALLBACK_MODEL` — sem ficar esperando por uma cota que não volta hoje.
  A tela avisa: *"Modelo principal ocupado — usando o reserva…"*.
- A conversa guardada é podada nas últimas ~12 idas e vindas, para o Shadow não
  ir ficando mais lento quanto mais tempo passa ligado.

O que mais gasta cota: o **modo aplicativo** (uma chamada por frase falada, para
transcrever), o **Modo Jogo** com dicas por IA, e retrospectos/reanálises.
O bordão, o relógio, o monitor do PC, o clima e os comandos salvos **não gastam nada**.

---

## 🛠️ Resolvendo problemas

- **"Falta configurar a chave da API"** → preencha `GEMINI_API_KEY` no `.env` e reabra.
- **O microfone não funciona** → na primeira vez, o navegador pede permissão do
  microfone; clique em **Permitir**. Use **Edge** ou **Chrome**.
- **A voz voltou a soar robótica** → o motor escolhido falhou e ele caiu na reserva
  (a etiqueta ao lado de "Voz" mostra "navegador"). Verifique se a pasta `voz-local`
  existe ou escolha à mão uma voz **★ (Natural)** na lista de reserva.
- **Demora ~3 s para falar** → você está no motor **Gemini**. Mude para **Local
  (rápida)** no painel de voz.
- **A janela abriu como uma aba de navegador comum** → os arquivos `.bat` precisam
  ser salvos em **ASCII puro**. Acento ou travessão dentro deles desalinha a leitura
  do `cmd`, que passa a comer o início das linhas e o `--app` nunca é executado.
- **Não fala nada** → verifique o volume e clique uma vez na janela (o navegador só
  libera áudio depois de uma interação).
- **A janela não abriu** → abra o navegador e vá em `http://localhost:4577`.
- **"Estou no limite de uso do plano gratuito"** → o plano grátis do Gemini permite
  poucos pedidos por minuto. Espere alguns segundos e fale de novo.
- **Quero desligar** → feche a janela preta do "Motor".

---

## 🧠 Como funciona (para curiosos)

```
Sua voz ──(Edge: reconhecimento pt-BR)──▶ Interface (HUD)
                                             │  envia o texto
                                             ▼
                             Motor local (Node/Express)
                                             │  "tá aí?" → responde o bordão na hora
                                             │  senão, conversa com o Gemini
                                             │  (ferramentas: abrir apps, pastas,
                                             │   sites, lembretes, busca na web)
                                             ▼
                             Gemini decide e executa as ações
                                             │  resposta em texto
                                             ▼
                             Motor gera a VOZ (Piper local, ~0,3s;
                             ou Gemini TTS, ~3s)
                                             │  áudio WAV (com cache em disco)
                                             ▼
                             Interface toca a fala e o reator pulsa no ritmo dela
```

A sua chave de API fica **no motor local**, nunca no navegador — mais seguro.

Feito com carinho. Bom proveito. ⚡
t e s t e  
 