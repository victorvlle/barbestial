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
| `LIMITE_TURNO_MS` | Tempo de cada turno | `35000` |
| `SMTP_HOST` | Servidor de e-mail (envio) | vazio (os e-mails saem no log) |
| `SMTP_PORTA` | Porta do servidor de e-mail | `587` |
| `SMTP_USUARIO` | Usuário do servidor de e-mail | vazio |
| `SMTP_SENHA` | Senha do servidor de e-mail | vazio |
| `EMAIL_REMETENTE` | Quem assina os e-mails | `Bar Bestial <nao-responda@barbestial.local>` |
| `URL_PUBLICA` | Endereço usado nos links dos e-mails | `RENDER_EXTERNAL_URL`, ou `localhost` |

Três delas merecem atenção em produção:

**`BANCO_CAMINHO`** precisa apontar para um lugar que sobreviva a reinícios. No
Render isso significa um disco montado (ver `render.yaml`). Sem disco, o arquivo
vive no sistema de arquivos temporário do container: funciona enquanto o
servidor está de pé e some no próximo deploy, levando junto as contas e o
ranking.

**`SESSAO_SEGREDO`** precisa ser fixa. Sem ela, o servidor sorteia uma chave
nova a cada boot e todo mundo é deslogado a cada deploy. No Render, o
`generateValue: true` do `render.yaml` resolve isso — o Render sorteia uma vez e
guarda.

**`SMTP_*`** decide se o e-mail sai de verdade. Sem essas variáveis nada quebra:
o servidor imprime o e-mail inteiro — com o link — no próprio log. Dá para
desenvolver e até socorrer alguém em produção lendo o log. Mas ninguém consegue
confirmar a conta sozinho, e sem confirmar a pontuação não entra no ranking.

## Ligando o envio de e-mail

Qualquer provedor que fale SMTP serve — Gmail com senha de app, Brevo, Resend,
Mailgun, o que você preferir. Nenhum código muda; é só preencher no painel do
Render, em **Environment**:

```
SMTP_HOST=smtp.seuprovedor.com
SMTP_PORTA=587
SMTP_USUARIO=voce@seudominio.com
SMTP_SENHA=<a senha ou chave do provedor>
EMAIL_REMETENTE=Bar Bestial <voce@seudominio.com>
URL_PUBLICA=https://barbestial.onrender.com
```

`URL_PUBLICA` é o endereço que vai dentro dos links. No Render, se você não
definir, o próprio `RENDER_EXTERNAL_URL` é usado.

**A senha do SMTP fica só no servidor.** Nada disso aparece no JavaScript do
navegador: a única coisa que a página pergunta é `/api/conta/config`, que
devolve apenas `email: true|false` (se o envio está ligado) e o tamanho mínimo
da senha. Um teste confere essa lista campo a campo — qualquer coisa nova que
alguém coloque lá derruba a suíte.

**Se o envio falhar, o cadastro continua valendo.** O erro é registrado no log e
a pessoa entra no jogo assim mesmo; ela usa o botão "Reenviar e-mail" depois.
Perder um e-mail não pode custar um cadastro.

## Como funciona a conta

Uma conta tem três coisas, todas obrigatórias: **e-mail, apelido e senha**. O
apelido é o que aparece no ranking; o e-mail ninguém vê.

| momento | o que acontece |
|---|---|
| cadastro | a conta nasce **já logada** e um link de confirmação é enviado |
| antes de confirmar | joga tudo normalmente, mas **fica fora do ranking** |
| clicou no link | a pontuação que já era dela passa a aparecer — nada se perde |
| esqueceu a senha | pede pelo **e-mail** e recebe um link de 1 hora |

A escolha de deixar jogar antes de confirmar é de propósito: a primeira partida
é o momento em que a pessoa decide se volta. Travar o jogo ali custaria mais do
que ganharia. O ranking, sim, exige confirmação — e isso protege a tabela de
quem tentaria farmar pontos com contas descartáveis.

### Recuperar a senha

**Só pelo e-mail.** A rota `/api/conta/esqueci` não recebe apelido, e isso é a
trava mais importante do sistema: o apelido está no ranking, à vista de todo
mundo. Se ele recuperasse senha, a lista de campeões viraria uma lista de alvos.

A resposta é **sempre a mesma**, exista a conta ou não — senão a rota viraria um
consultor gratuito de "este e-mail tem conta aqui?".

### Os links do e-mail

Guardamos apenas o **hash** de cada token (`tokens.hash`), nunca o token em si:
quem lesse o banco não conseguiria usar um link. Além disso:

- servem **uma vez só**;
- valem 48 horas (confirmação) ou 1 hora (recuperação);
- pedir um novo **invalida o anterior** do mesmo tipo;
- o link de confirmar e-mail **não** serve para trocar senha, e vice-versa;
- apagar uma conta apaga os tokens dela junto (`ON DELETE CASCADE`).

E um limite de **um e-mail por minuto por endereço**, para o "esqueci a senha"
não virar um jeito de bombardear a caixa de entrada de outra pessoa.

## Migrações

O banco se atualiza sozinho ao subir o servidor, usando `PRAGMA user_version`.
Cada degrau roda uma vez só; reiniciar não repete nada.

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

Alternativa sem expor nada na internet: `npm run contas`, pelo Shell do Render.

## Testando o fluxo de e-mail

Sem SMTP configurado, o servidor imprime cada e-mail no console — com o link
inteiro. É assim que os testes automatizados percorrem o caminho completo
(cadastro → link → conta confirmada → ranking) sem nenhum servidor de e-mail e,
principalmente, **sem nenhuma rota secreta de teste no servidor**: o que os
testes exercitam é exatamente o código de produção.

Para experimentar na sua máquina: rode `npm start`, crie uma conta e olhe o
terminal — o link está lá.
