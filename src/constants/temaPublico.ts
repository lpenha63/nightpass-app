/**
 * Paleta das páginas do COMPRADOR: compra do ingresso, retorno do pagamento e
 * ingresso emitido.
 *
 * O resto do NightPass é escuro e segue o tema do usuário logado. Estas três não
 * têm usuário logado — quem abre recebeu um link, vai digitar CPF e pagar, muitas
 * vezes na rua, no sol, num aparelho qualquer. Fundo claro lê melhor nessa cena e
 * é o que se espera de uma página de pagamento.
 *
 * Mora num arquivo só porque são TRÊS telas da mesma jornada: cada uma com a sua
 * cópia era garantir que um dia ficassem diferentes — e o comprador atravessa as
 * três em sequência, então a diferença apareceria para ele.
 *
 * Os tons escuros são recalculados para fundo branco: o verde e o âmbar do tema
 * escuro dão cerca de 2:1 aqui, ilegíveis.
 */
export const CP = {
  bg: '#f4f5f7',
  card: '#ffffff',
  brd: '#e3e6ea',
  acc: '#1d4ed8',
  grn: '#047857',
  red: '#be123c',
  gold: '#a16207',
  txt: '#0d1420',
  mut: '#5b6878',
  sub: '#3d4857',
} as const
