// Toda conversa com o servidor passa por aqui.
// O cliente so envia intencoes; quem decide qualquer coisa e o servidor.

const socket = io();

// enviar() transforma o "acknowledgement" do Socket.IO em Promise,
// para dar para escrever: const r = await enviar('criar-sala', {...})
function enviar(evento, dados = {}) {
  return new Promise((resolve) => socket.emit(evento, dados, resolve));
}

// Identidade que sobrevive a um F5. Sem isso, recarregar a pagina viraria
// um jogador novo e a partida ficaria com fantasmas na sala.
function meuJogadorId() {
  let id = localStorage.getItem('barbestial:jogadorId');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
    localStorage.setItem('barbestial:jogadorId', id);
  }
  return id;
}

// Preferencias do jogador, guardadas no proprio navegador.
const preferencias = {
  previaLigada: () => localStorage.getItem('barbestial:previa') !== 'nao',
  definirPrevia: (ligada) => localStorage.setItem('barbestial:previa', ligada ? 'sim' : 'nao'),
  musicaLigada: () => localStorage.getItem('barbestial:musica') !== 'nao',
  definirMusica: (ligada) => localStorage.setItem('barbestial:musica', ligada ? 'sim' : 'nao'),
};

const meuNome = {
  ler: () => localStorage.getItem('barbestial:nome') || '',
  salvar: (nome) => localStorage.setItem('barbestial:nome', nome),
};

// Catalogo das cartas, buscado do servidor para nao duplicar cards.js aqui.
let CATALOGO = {};
async function carregarCatalogo() {
  const resposta = await fetch('/api/animais');
  const { animais } = await resposta.json();
  CATALOGO = Object.fromEntries(animais.map((a) => [a.id, a]));
}
