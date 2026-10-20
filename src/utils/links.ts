/**
 * Endereços dos links que vão para o WhatsApp.
 *
 * Dois defeitos corrigidos aqui, os dois vistos num print do cliente:
 *
 * 1. CAMINHO, NÃO QUERY STRING. O WhatsApp parava de reconhecer o link no `?`:
 *    `https://.../lista.html?t=<uuid>` chegava com só `t=<uuid>` clicável, e tocar
 *    nele não abria nada. O texto enviado estava correto — conferido no log de
 *    envio, sem caractere oculto — então o problema é o reconhecimento do `?`.
 *    Com `/r/<uuid>` não há query string e o link inteiro vira clicável.
 *
 * 2. DOMÍNIO. O link era montado com `window.location.origin`. Quem abrisse o
 *    painel pelo endereço cru da Vercel mandava ao cliente um link
 *    `nightpass-app.vercel.app` — que até abre, mas não é o endereço da casa.
 *
 * O domínio oficial só substitui o da Vercel: em localhost e em qualquer outro
 * domínio (um cliente com domínio próprio, amanhã) vale o endereço em uso.
 */

const OFICIAL = 'https://www.nightpassapp.com.br'

export function basePublica(): string {
  if (typeof window === 'undefined') return OFICIAL
  const origem = window.location.origin
  return /\.vercel\.app$/i.test(window.location.hostname) ? OFICIAL : origem
}

/**
 * Página onde o titular da reserva monta a lista de convidados.
 * Sem token devolve '' — reserva antiga pode não ter. Quem envia precisa checar,
 * senão o cliente recebe um link que não leva a lugar nenhum.
 */
export const linkReserva = (token?: string | null) => token ? `${basePublica()}/r/${token}` : ''

/**
 * Convite individual — o link que o titular da reserva manda para CADA convidado.
 * É o de maior volume, e por isso o que mais sofria com o corte no "?".
 */
export const linkConvite = (token?: string | null) => token ? `${basePublica()}/c/${token}` : ''

/** Página de uma tarefa da equipe. Mesma regra do link de reserva. */
export const linkTarefa = (token?: string | null) => token ? `${basePublica()}/t/${token}` : ''
