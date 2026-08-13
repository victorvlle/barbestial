# Bar Bestial - versao digital multiplayer

Implementacao web (2 a 4 jogadores, tempo real) do jogo de cartas Bar Bestial / Beasty Bar.

## Como rodar

```bash
npm install      # so na primeira vez
npm run dev      # sobe o servidor em http://localhost:3001
npm test         # 38 testes das regras e das salas (rapido, em memoria)
npm run test:e2e # sobe o servidor e simula 2 jogadores por Socket.IO
npm run test:ui  # opcional: abre 2 navegadores de verdade e joga clicando
                 # (antes: npm i -D playwright && npx playwright install chromium)
```

## Stack

- Backend: Node.js + Express (servir arquivos) + Socket.IO (tempo real)
- Frontend: HTML + CSS + JavaScript puro (sem build)

## Estrutura

```
barbestial/
  package.json          dependencias e scripts
  server/
    index.js            ponto de entrada: Express + Socket.IO
    socket/
      handlers.js       traduz eventos do socket em acoes de jogo
    game/
      cards.js          as 12 cartas, seus poderes e as constantes de regra
      deck.js           baralho, embaralhamento e compra
      queue.js          motor do jogo: os 12 poderes e a sequencia do turno
      gameState.js      estado da partida, turnos, placar e visao de cada jogador
      room.js           salas: jogadores, codigo, ciclo de vida
  tests/
    regras.test.js      os 12 poderes, a sequencia do turno e uma partida inteira
    salas.test.js       criar/entrar/sair, reconexao, quem pode comecar
    e2e.js              ponta a ponta: 2 jogadores por socket + uma partida inteira
    navegador.js        opcional: 2 navegadores de verdade jogando pela interface
    melhorias.js        opcional: previa, botao "i", instrucoes e log colorido
  public/
    index.html          unica pagina do cliente
    css/style.css       visual
    js/
      socketClient.js   conexao com o servidor
      animacao.js       motor de animacao das cartas (tecnica FLIP)
      render.js         desenha o estado na tela
      main.js           inicializacao, cliques e reproducao das animacoes
    assets/
      animais.svg       as 12 silhuetas, cada uma como <symbol>
```

## Status

Passo 1 concluido: ambiente e esqueleto.
Passo 2a concluido: os 12 animais e seus poderes em server/game/cards.js.
Passo 2b concluido: motor do jogo completo (deck, fila, poderes, turnos, placar) com 23 testes passando.
Passo 3 concluido: salas com codigo, lobby, reconexao e inicio de partida.
Passo 4 concluido: mesa clicavel. O jogo esta jogavel do inicio ao fim.
Passo 5a concluido: tema "bar noturno" e animacao das cartas quadro a quadro.
Passo 5b concluido: silhuetas proprias em SVG no lugar dos emojis, na cor do dono.
Passo 5c concluido: log colorido por autor, botao "i" nas cartas, previa da jogada
e menu com instrucoes.
Passo 6: publicacao preparada (render.yaml, rota /saude, engines no package.json).

## Publicar

O projeto ja esta pronto para hospedagem: o servidor respeita a variavel PORT,
nao tem nenhum endereco fixo no codigo e existe uma rota /saude que a
hospedagem usa para saber se ele subiu.

Primeira vez:

```bash
git init -b main
git add .
git commit -m "primeira versao"
git remote add origin https://github.com/SEU-USUARIO/barbestial.git
git push -u origin main
```

Depois, no painel do Render: New > Blueprint > escolher o repositorio >
Deploy Blueprint. Ele le o render.yaml e cria o servico sozinho.

Da segunda vez em diante, publicar e so:

```bash
npm test              # sempre antes
git add .
git commit -m "o que mudou"
git push
```

O Render reconstroi sozinho em um ou dois minutos.

### O que saber

- Publicar REINICIA o servidor, e as partidas em andamento se perdem, porque
  o estado vive em memoria. Publique quando ninguem estiver jogando.
- No plano gratuito o servico dorme apos 15 minutos sem acesso e leva cerca de
  1 minuto para acordar. Quem abrir o link primeiro espera; os outros entram na hora.
- Quem ja estiver com a pagina aberta so recebe a versao nova ao recarregar.

## Pre-visualizacao da jogada

Passar o mouse numa carta da mao mostra como a fila ficaria. Quem calcula e o
SERVIDOR: em estadoVisivelPara() ele simula, para cada carta da mao de quem
esta na vez, o resultado da jogada (e uma simulacao por opcao nas cartas que
pedem decisao). O cliente so recebe pronto e desenha - por isso a previa e
instantanea e as regras continuam existindo num lugar so.
A area da previa tem altura fixa mesmo vazia: se ela aparecesse empurrando o
resto, a carta fugiria de baixo do cursor na hora do clique.

## Mexendo no visual

Ritmo das animacoes: as duas constantes no topo de public/js/animacao.js
(DURACAO e PAUSA_ENTRE_QUADROS). Sao o unico lugar a ajustar.

Desenhos dos animais: public/assets/animais.svg, um <symbol> por bicho em
viewBox 0 0 100 100. Convencao do estilo: o corpo usa fill="currentColor"
(a carta escolhe a cor), os detalhes escuros usam fill="#000" com opacidade
e os claros fill="#fff" com opacidade. Detalhe desenhado na mesma cor do
corpo desaparece e o bicho vira uma mancha.

## Como a animacao funciona

O servidor manda, junto com o estado, uma lista de "quadros": uma foto do
tabuleiro depois de cada passo do turno (carta chega, poder da carta, acoes
recorrentes, porta do bar). O cliente reproduz esses quadros com uma pausa
entre eles, e usa a tecnica FLIP para animar a diferenca de posicao de cada
carta. Nenhum movimento e programado a mao: qualquer mudanca de posicao vira
animacao automaticamente.
