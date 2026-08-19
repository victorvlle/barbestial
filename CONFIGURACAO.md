# Configuração do servidor

Tudo aqui é opcional para rodar na sua máquina — o jogo sobe com `npm start` sem
configurar nada. As variáveis existem para produção.

## Variáveis de ambiente

| Variável | Para que serve | Padrão |
|---|---|---|
| `PORT` | Porta do servidor | `3001` |
| `TURSO_URL` | Endereço do banco no Turso (`libsql://...`) | vazio (usa arquivo local) |
| `TURSO_TOKEN` | Token de acesso ao banco do Turso | vazio |
| `BANCO_CAMINHO` | Arquivo local, quando não há Turso | `data/barbestial.db` |
| `SESSAO_SEGREDO` | Chave que assina os crachás de sessão | sorteada a cada boot |
| `FUSO_MINUTOS` | Fuso usado para decidir quando a semana vira | `-180` (Brasília) |
| `LIMITE_TURNO_MS` | Tempo de cada turno | `35000` |
| `ADMIN_SEGREDO` | Senha do painel `/admin` | vazio (o painel não existe) |

Três delas merecem atenção em produção:

**`TURSO_URL`** é a variável mais importante do projeto. Sem ela o servidor
grava num arquivo local — e o disco do Render é descartável: some a cada deploy,
a cada reinício e a cada 15 minutos de hibernação, levando junto todas as contas
e o ranking. Com ela, o banco fica fora do servidor e os dados sobrevivem a
tudo isso. Veja "Ligando o banco no Turso" abaixo.

**`SESSAO_SEGREDO`** precisa ser fixa. Sem ela, o servidor sorteia uma chave
nova a cada boot e todo mundo é deslogado — e no plano gratuito, onde o servidor
hiberna depois de 15 minutos parado, isso acontece várias vezes por dia. No
Render, o `generateValue: true` do `render.yaml` resolve: ele sorteia uma vez e
guarda.

**`ADMIN_SEGREDO`** é o que liga o painel `/admin`, e é por lá que você define
uma senha nova para quem esqueceu a dela. Sem essa variável o painel não existe
(responde 404) — e aí ninguém tem como recuperar conta nenhuma.

## Como funciona a conta

Uma conta tem três coisas: **e-mail, apelido e senha**. O apelido é o que
aparece no ranking; o e-mail ninguém vê.

Não há etapa nenhuma entre preencher o cadastro e jogar: a conta já nasce
logada e a pontuação vale no ranking desde a primeira partida.

### Por que não existe "esqueci minha senha"

Recuperar senha sozinho exige mandar e-mail, e o servidor gratuito onde o jogo
roda **bloqueia as portas de SMTP**. Um botão que promete um link que nunca
chega é pior do que não ter botão.

Então a recuperação é combinada: quem esquece a senha avisa o dono do jogo, que
define uma nova no painel `/admin`. É para isso que o e-mail é pedido no
cadastro — é como saber de quem é cada conta.

### As senhas

Guardadas como `scrypt(senha, sal)`, nunca em texto. **Ninguém consegue ler a
senha de ninguém**, nem o administrador, nem quem invadir o banco. O painel
`/admin` só consegue *definir* uma nova — ler e escrever são coisas diferentes,
e só a segunda é necessária para resolver o problema de quem esqueceu.

Se o banco vazar, as senhas não vão junto. Como quase todo mundo repete senha,
o que estaria em jogo não seria a conta no jogo: seria o e-mail das pessoas.

## Ligando o banco no Turso

O Turso é SQLite hospedado: o mesmo banco que o jogo sempre usou, só que fora do
servidor. Plano gratuito sem prazo de validade, 5 GB, e — o que importa aqui —
**os dados não somem quando o Render reinicia**.

1. Crie a conta em [turso.tech](https://turso.tech) e um banco novo (região dos
   Estados Unidos é a mais perto do Render).
2. Copie as duas informações que o painel mostra: a **URL** (começa com
   `libsql://`) e um **token de acesso**.
3. No Render, em **Environment**, crie:

```
TURSO_URL=libsql://seu-banco-seu-usuario.turso.io
TURSO_TOKEN=<o token>
```

O token é um segredo — ele vale como senha do banco. Nunca coloque no
repositório, em print ou em conversa: cole direto no painel do Render.

Para desenvolver na sua máquina você não precisa de nada disso: sem `TURSO_URL`,
o servidor cria `data/barbestial.db` ali mesmo e funciona igual.

### Como ver os dados

Três caminhos, do mais simples ao mais direto:

- o painel `/admin` do próprio jogo (ver abaixo);
- `npm run contas`, que imprime contas e ranking no terminal;
- o painel do Turso, que tem um editor de SQL no navegador.

### Backup

O banco inteiro cabe num arquivo. Com a CLI do Turso:

```
turso db shell seu-banco .dump > backup.sql
```

Guarde esse arquivo de vez em quando. É o que torna a promessa de "os dados não
se perdem" independente de qualquer empresa.

## Migrações

O banco se atualiza sozinho ao subir o servidor. A versão do formato fica numa
tabela chamada `esquema`; cada degrau roda uma vez só, e reiniciar não repete
nada.

> A versão morava no `PRAGMA user_version`, que o SQLite local aceita numa boa.
> **O Turso recusa escrever pragma pela rede** (`SQL not allowed statement`) e o
> servidor nem subia. Bancos marcados do jeito antigo continuam sendo
> reconhecidos — há um teste só para isso.

| degrau | o que faz |
|---|---|
| 0 → 1 | cria `usuarios`, `partidas`, `resultados` e os índices |
| 1 → 2 | senha e login externo viram opcionais, e entra a coluna `email_chave` |
| 2 → 3 | o login externo sai de cena: entram `email`, `email_verificado_em` e a tabela `tokens` |

**Nenhuma migração apaga conta.** Quando uma coluna precisa mudar de regra (o
SQLite não sabe `ALTER COLUMN`), a tabela é reconstruída copiando as linhas
antigas. Partidas e ranking seguem intactos. Há 8 testes em
`tests/migracao.test.js` que montam bancos nos formatos antigos e conferem que
tudo sobrevive. No degrau 2 → 3, quem tinha e-mail vindo do login externo já
nasce com ele **confirmado** — aquele e-mail acabara de ser verificado, não faz
sentido pedir de novo.

## CORS e CSRF

Nenhum dos dois precisa de configuração aqui, e isso é uma escolha:

- **CORS**: o front é servido pelo mesmo servidor que responde a API. Não há
  requisição entre origens. Não habilitamos CORS de propósito — abrir a API para
  outras origens sem necessidade só aumentaria a superfície de ataque.
- **CSRF**: o crachá de sessão viaja no cabeçalho `Authorization`, nunca em
  cookie. Um POST forjado de outro site chega sem crachá e é recusado como
  qualquer pedido anônimo.

## Onde ficam os dados

Um arquivo SQLite (`server/dados/banco.js`):

- `usuarios` — uma linha por conta (e-mail, apelido, senha em hash)
- `tokens` — os links de e-mail em aberto, guardados como hash
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

Duas coisas que ele **faz**:

- **Definir uma senha nova** para uma conta (botão "nova senha" na linha dela).
  É a recuperação de conta deste jogo. A senha não volta na resposta nem fica
  guardada: você combina com a pessoa por fora.
- **Baixar a planilha** das contas em CSV, que o Excel e o Google Sheets abrem
  com dois cliques. É a sua cópia dos dados, na sua mão. Sem senha nenhuma
  dentro — planilha é arquivo que se compartilha por link sem querer.

Alternativa sem expor nada na internet: `npm run contas`, pelo Shell do Render.

