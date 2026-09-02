/**
 * Quanto uma escala custa à casa.
 *
 * Existe num arquivo só porque esta conta já esteve copiada em três telas — Budget,
 * Relatórios e folha — e elas divergiram: o mesmo dia aparecia como R$ 1.020 num
 * lugar e R$ 1.360 no outro.
 *
 * A regra, na ordem:
 *
 * 1. `paid_cents` — o valor fechado na folha. Foi digitado por alguém olhando o
 *    turno, então manda em tudo.
 * 2. `custom_fee_cents` — combinado para aquele evento específico.
 * 3. `daily_rate_cents` do cadastro — a diária padrão do freelancer.
 *
 * O passo 3 NÃO vale para quem é `funcionario`. Funcionário é assalariado: a escala
 * do dia normal — inclusive a que o cron cria sozinho em todo dia de operação — não
 * gera custo de diária. Ele só custa quando faz jornada de freelance, e aí o valor é
 * lançado à mão e cai no passo 1 ou 2.
 *
 * Sem essa exceção, bastaria alguém preencher uma diária no cadastro de um
 * funcionário para todo dia de operação passar a cobrar um valor que ninguém deve.
 */

export interface EscalaComCusto {
  paid_cents?: number | null
  custom_fee_cents?: number | null
  discount_cents?: number | null
  freelancers?: { daily_rate_cents?: number | null; staff_type?: string | null } | null
}

export function custoDaEscala(ef: EscalaComCusto): number {
  if (ef.paid_cents != null) return ef.paid_cents

  const ehFuncionario = (ef.freelancers?.staff_type ?? 'freelancer') === 'funcionario'
  const diariaDoCadastro = ehFuncionario ? 0 : (ef.freelancers?.daily_rate_cents ?? 0)
  const bruto = ef.custom_fee_cents ?? diariaDoCadastro

  return Math.max(0, bruto - (ef.discount_cents ?? 0))
}
