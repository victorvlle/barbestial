// AS REAÇÕES: a lista oficial dos emojis que dá para mandar na partida.
//
// Isto NÃO é um chat. Não existe campo de texto em lugar nenhum do projeto, e é
// de propósito: a única coisa que um jogador consegue mandar para outro é um
// destes 31 emojis. Como a lista é fechada e mora no servidor, não há como
// forjar um "emoji" no console e escrever qualquer coisa na tela dos outros -
// o servidor recusa o que não está aqui.
//
// A mesma lista é servida em /api/reacoes para o navegador desenhar a bandeja.
// Uma lista só, um lugar só: acrescentar um emoji aqui já o faz aparecer na
// tela, sem mexer no cliente.
//
// A ORDEM importa: é a ordem em que eles aparecem na bandeja. Estão agrupados
// por clima - alegria, susto, tédio, sono, gestos e símbolos - porque numa
// bandeja pequena o jogador acha pelo formato, não lendo um por um.

const REACOES = [
  '😁', '🥲', '🫪', '🥳', '😨', '🥱',
  '🙄', '😳', '😡', '🤫', '🥶', '😎',
  '😭', '🤨', '🫠', '😏', '😝', '😚',
  '🤪', '😂', '😴', '😵', '👍🏻', '👏🏻',
  '🤡', '💀', '🔥', '❤️', '🚫', '💤',
  '⏳',
];

// Trava de ritmo: quantas reações uma pessoa pode mandar num intervalo.
// Não é para punir ninguém - é para um clique nervoso (ou um script) não
// encher a tela de todo mundo. Seis em quatro segundos dá para comemorar uma
// jogada boa e não dá para fazer chuva de emoji.
const LIMITE = { quantas: 6, janelaMs: 4000 };

const existe = (emoji) => REACOES.includes(emoji);

module.exports = { REACOES, LIMITE, existe };
