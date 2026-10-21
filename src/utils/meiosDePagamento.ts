/**
 * Leitura do retorno da RPC `house_payment_status`.
 *
 * Existe porque TRÊS telas liam esse retorno por conta própria e duas estavam
 * lendo um formato que não existe mais: esperavam uma linha só, com os campos
 * `tem_pix` e `provedores`. A RPC devolve UMA LINHA POR PROVEDOR, com `provider`
 * e `prioridade`. Como os campos antigos vinham `undefined`, o resultado era
 * sempre "nada configurado" — a aba Eventos avisava que não havia meio de
 * recebimento numa casa com Mercado Pago ativo, enquanto Configurações, que lia
 * certo, dizia o contrário.
 *
 * Com a leitura num lugar só, mudar a RPC quebra um ponto, não três.
 */

export interface LinhaPagamento { provider: string; prioridade?: number }

export interface MeiosDePagamento {
  /** Todos os provedores ativos, incluindo 'pix_manual'. */
  ids: string[]
  /** Chave PIX preenchida na casa. */
  pix: boolean
  /** Algum gateway de verdade (Mercado Pago, Asaas, ...). PIX manual não conta. */
  gateway: boolean
  /** O gateway de menor prioridade — o que o comprador vê primeiro. */
  principal: string | null
  /** Dá para receber de alguma forma. */
  recebe: boolean
}

export function lerMeiosDePagamento(data: unknown): MeiosDePagamento {
  const linhas = (Array.isArray(data) ? data : []) as LinhaPagamento[]
  const ids = linhas.map(l => l?.provider).filter((p): p is string => !!p)
  const gws = linhas
    .filter(l => l?.provider && l.provider !== 'pix_manual')
    .sort((a, b) => (a.prioridade ?? 999) - (b.prioridade ?? 999))
  const pix = ids.includes('pix_manual')
  const gateway = gws.length > 0
  return { ids, pix, gateway, principal: gws[0]?.provider ?? null, recebe: pix || gateway }
}

/** Nome de exibição do provedor. */
export function nomeDoMeio(id: string): string {
  const nomes: Record<string, string> = {
    mercadopago: 'Mercado Pago', asaas: 'Asaas', pagseguro: 'PagSeguro',
    stripe: 'Stripe', pagarme: 'Pagar.me', infinitepay: 'InfinitePay',
    cielo: 'Cielo', pix_manual: 'PIX',
  }
  return nomes[id] ?? id
}
