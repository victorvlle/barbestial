// Toda conversa com o servidor passa por aqui.
// O cliente so envia intencoes; quem decide qualquer coisa e o servidor.

// O cracha da sessao mora aqui. Guardado no navegador para o jogador nao ter
// que entrar de novo a cada F5; quem confere se ele vale e o servidor.
const sessao = {
  ler: () => localStorage.getItem('barbestial:sessao') || '',
  salvar: (token) => localStorage.setItem('barbestial:sessao', token),
  apagar: () => localStorage.removeItem('barbestial:sessao'),
};

// O socket nasce DESLIGADO: sem conta, nao ha o que conversar com o servidor.
// Quem liga e conta.js, depois do login.
//
// `auth` e uma funcao, e nao um objeto pronto, de proposito: o Socket.IO a
// chama a cada (re)conexao. Assim uma queda de internet depois de trocar de
// conta reconecta com o cracha certo, sem ninguem precisar lembrar disso.
const socket = io({
  autoConnect: false,
  auth: (feito) => feito({ token: sessao.ler() }),
});

// enviar() transforma o "acknowledgement" do Socket.IO em Promise,
// para dar para escrever: const r = await enviar('criar-sala', {...})
function enviar(evento, dados = {}) {
  return new Promise((resolve) => socket.emit(evento, dados, resolve));
}

// Pedido HTTP com o cracha junto. E o mesmo formato de resposta do socket:
// { ok: true, ... } ou { ok: false, erro }.
async function pedir(caminho, { metodo = 'GET', corpo } = {}) {
  try {
    const resposta = await fetch(caminho, {
      method: metodo,
      headers: {
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        ...(sessao.ler() ? { Authorization: `Bearer ${sessao.ler()}` } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return await resposta.json();
  } catch (erro) {
    return { ok: false, erro: 'Sem conexão com o servidor.' };
  }
}

// Preferencias do jogador, guardadas no proprio navegador.
const preferencias = {
  previaLigada: () => localStorage.getItem('barbestial:previa') !== 'nao',
  definirPrevia: (ligada) => localStorage.setItem('barbestial:previa', ligada ? 'sim' : 'nao'),
  musicaLigada: () => localStorage.getItem('barbestial:musica') !== 'nao',
  definirMusica: (ligada) => localStorage.setItem('barbestial:musica', ligada ? 'sim' : 'nao'),
  // Hologramas: ligados por padrao. Quem prefere a mesa limpa (ou tem um
  // computador mais fraco) desliga aqui e o jogo roda exatamente igual.
  holoLigado: () => localStorage.getItem('barbestial:holo') !== 'nao',
  definirHolo: (ligado) => localStorage.setItem('barbestial:holo', ligado ? 'sim' : 'nao'),
};

// A conta de quem esta jogando agora. Preenchida por conta.js depois do login e
// zerada no logout. O `id` daqui e o mesmo id que o servidor usa como jogador -
// e por isso que a partida cai na conta certa sem ninguem precisar combinar nada.
let CONTA = null;

// Catalogo das cartas, buscado do servidor para nao duplicar cards.js aqui.
let CATALOGO = {};
async function carregarCatalogo() {
  const resposta = await fetch('/api/animais');
  const { animais } = await resposta.json();
  CATALOGO = Object.fromEntries(animais.map((a) => [a.id, a]));
}
