# As músicas das festas

O que está nesta pasta é o que toca. **Não existe lista fixa de nomes de
arquivo**: o jogo abre a pasta da festa, vê o que tem lá dentro e monta a
playlist. Adicionar música é jogar o arquivo na pasta; tirar é apagar.

## Como o nome do arquivo vira o que aparece no tocador

O formato é `Título - Artista.mp3`, separado pelo **primeiro** tracinho:

| arquivo | no tocador |
|---|---|
| `Levels - Avicii.mp3` | Avicii — Levels |
| `Lioness - Swedish House Mafia ft. Niki & The Dove.mp3` | Swedish House Mafia ft. Niki & The Dove — Lioness |
| `musica sem tracinho.mp3` | musica sem tracinho |

Espaço, parêntese e acento no nome funcionam normalmente.

## Como adicionar música

1. jogue os arquivos originais em `audio-original/<festa>/` — com o nome que
   você quiser, em mp3, wav, flac, m4a…;
2. rode `node scripts/abafar.js`;
3. as versões tratadas (com o efeito de "festa do outro lado da parede")
   aparecem aqui, em `public/assets/festas/<festa>/`.

O servidor lê a pasta a cada pedido: assim que o arquivo estiver aqui, a música
entra na festa — sem reiniciar nada.

    npm run musicas    # mostra a playlist de cada festa, do jeito que vai tocar

Festa sem nenhum arquivo simplesmente não aparece no menu.

## As festas registradas

| pasta | festa |
|---|---|
| `edm/` | ⚡ EDM |
| `summer-eletro-2000s/` | ☀️ Summer Eletro 2000s |
| `house/` | 🏠 House |
| `sertanejo/` | 🤠 Sertanejo |
| `pop/` | 🎤 Pop |
| `funk-brasileiro/` | 🔊 Funk Brasileiro |
| `rock-internacional/` | 🎸 Rock Internacional |
| `classicas/` | 💿 Clássicas (antes de 1990) |

Todas já existem no jogo. **Festa sem arquivo não aparece no menu** — ela entra
sozinha no dia em que a pasta tiver música.

Uma festa fora dessa lista precisa de três linhas em `server/game/festas.js`
(id, nome, emoji) e da pasta. O player não muda.

## Quando a música toca

Só dentro da partida. Escolher a festa no menu é só escolher; a playlist começa
quando a partida começa e para quando você volta para o menu.

## Para publicar no Render

Os arquivos desta pasta estão **fora do repositório** (`.gitignore`), então o
site publicado não tem música. Para ter, escolha um caminho:

- **subir os arquivos junto com o código** — tire a linha
  `public/assets/festas/*/*` do `.gitignore` e faça o commit. Simples, mas
  coloca gravações protegidas num repositório público;
- **hospedar o áudio fora** — o `FESTAS_PASTA` e a montagem em
  `server/index.js` já permitem apontar para outro lugar.

## Sobre direitos

Gravações comerciais são protegidas. Ter o arquivo é uma coisa; **publicá-lo num
site aberto é outra** — isso é distribuição e precisa de licença de quem é dono
da gravação. Existem caminhos legais que dão o mesmo clima (bibliotecas
licenciadas para jogos, trilhas royalty-free), e vale considerar antes de deixar
o jogo público com essas faixas.
