# Configuração do servidor

Tudo aqui é opcional para rodar na sua máquina — o jogo sobe com `npm start` sem
configurar nada. As variáveis existem para produção.

## Variáveis de ambiente

| Variável | Para que serve | Padrão |
|---|---|---|
| `PORT` | Porta do servidor | `3001` |
| `BANCO_CAMINHO` | Onde fica o arquivo do SQLite | `data/barbestial.db` |
| `SESSAO_SEGREDO` | Chave que assina os crachás de sessão | sorteada a cada boot |
| `FUSO_MINUTOS` | Fuso usado para decidir quando a semana vira | `-180` (Brasília) |
| `GOOGLE_CLIENT_ID` | Liga o botão "Entrar com o Google" | vazio (botão não aparece) |
| `LIMITE_TURNO_MS` | Tempo de cada turno | `35000` |

Duas delas merecem atenção em produção:

**`BANCO_CAMINHO`** precisa apontar para um lugar que sobreviva a reinícios. No
Render isso significa um disco montado (ver `render.yaml`). Sem disco, o arquivo
vive no sistema de arquivos temporário do container: funciona enquanto o
servidor está de pé e some no próximo deploy, levando junto as contas e o
ranking.

**`SESSAO_SEGREDO`** precisa ser fixa. Sem ela, o servidor sorteia uma chave
nova a cada boot e todo mundo é deslogado a cada deploy. No Render, o
`generateValue: true` do `render.yaml` resolve isso — o Render sorteia uma vez e
guarda.

## Ligando o login com o Google — OBRIGATÓRIO

**Sem `GOOGLE_CLIENT_ID` ninguém consegue se cadastrar.** Toda conta precisa de
apelido + senha + conta do Google conectada, porque o Google é a única prova
aceita para recuperar a senha. Quem já tem conta ainda consegue entrar por
apelido e senha, mas cadastros novos ficam bloqueados.

Para ligar o botão do Google:

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um
   projeto (ou use um que já tenha).
2. Em **APIs e serviços → Tela de permissão OAuth**, configure a tela de consentimento.
   Tipo de usuário "Externo" serve; preencha nome do app e e-mail de contato.
3. Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**,
   escolha **Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas**, adicione os endereços de onde o jogo é
   servido — um por linha:
   - `http://localhost:3001` (para testar na sua máquina)
   - `https://SEU-APP.onrender.com` (a URL de produção)
5. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) e
   coloque em `GOOGLE_CLIENT_ID`, no painel do Render em **Environment**.

Não existe "client secret" neste fluxo, e não há nada para esconder: o ID do
cliente é público por natureza — o Google exige que ele apareça na página. O que
garante a segurança é a **assinatura** do crachá que o Google devolve, conferida
no servidor com as chaves públicas do próprio Google
(`server/auth/google.js`). Nenhuma senha do Google passa por este servidor.

## Como funciona a conta

Uma conta tem **três** identificações, e nenhuma é opcional:

| | para que serve |
|---|---|
| apelido | o login do dia a dia e o nome no ranking |
| senha | guardada como `scrypt(senha, sal)`; a senha em si não existe no banco |
| Google | a única prova aceita para recuperar a senha |

**Entrar** no dia a dia: apelido+senha **ou** o botão do Google, tanto faz.

**Recuperar a senha**: só pelo Google. A rota `/api/conta/recuperar` **não
recebe apelido** — a conta é encontrada pelo Google em que a pessoa acabou de
entrar. Saber o apelido de alguém não abre porta nenhuma.

## Onde ficam os dados

Um arquivo SQLite, com quatro tabelas (`server/dados/banco.js`):

- `usuarios` — uma linha por conta (apelido, senha em hash, Google)
- `partidas` — uma linha por partida concluída
- `resultados` — uma linha por jogador em cada partida
- e os índices por semana, que fazem o ranking ser instantâneo

Cada resultado nasce carimbado com a semana a que pertence, então **nada é
apagado quando a semana vira**: o ranking apenas filtra pela semana atual. O
histórico continua inteiro em `/api/ranking?semana=2026-S32`.

## Backup

O banco inteiro é um arquivo só. Copiar `barbestial.db` (e, se existirem,
`barbestial.db-wal` e `barbestial.db-shm`) é o backup completo.

## Painel de administração

`GET /admin` mostra as contas cadastradas, o ranking da semana e as últimas
partidas, com atualização automática a cada 15 segundos.

Para ligar, defina `ADMIN_SEGREDO` no Render (**Environment**) com uma senha
longa e aleatória. **Sem essa variável a rota não existe**: `/admin` responde
404 como qualquer endereço inventado — esquecer de configurar deixa o painel
fechado, nunca aberto.

A senha vai num cabeçalho `Authorization`, nunca na URL (a URL ficaria no
histórico do navegador e nos registros de acesso). Tentativas erradas são
freadas por IP; acertos não contam para o freio.

O painel nunca devolve `senha_hash` nem `senha_sal` — nem para o administrador.

Alternativa sem expor nada na internet: `npm run contas`, pelo Shell do Render.

## Modo de teste do Google

Os testes automatizados precisam percorrer o cadastro, e não há como gerar um
crachá de verdade do Google sem navegador e conta real. `GOOGLE_MODO_TESTE=1`
faz o servidor aceitar crachás falsos no formato `teste:<id>:<email>`.

**Isso não liga em produção.** A checagem em `server/auth/google.js` exige que
`NODE_ENV` seja diferente de `production` — e o `render.yaml` define
`NODE_ENV=production` justamente para fechar essa porta. Se alguém definir a
variável em produção, o servidor a ignora e avisa no log.
