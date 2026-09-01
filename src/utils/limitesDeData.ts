/**
 * Faixas aceitaveis para campos de data.
 *
 * Existe porque `<input type="date">` nao tem nocao nenhuma de plausibilidade: o
 * segmento do ano aceita qualquer numero, e digitar "26" grava o ano 26. Sem `min`
 * e `max` o campo aceita calado, e o erro so aparece meses depois, num relatorio.
 *
 * Foi assim que a base ficou com eventos em 0026 e 2006, e com 148 datas de
 * nascimento entre o ano 1 e o ano 275760.
 *
 * Usar SEMPRE junto com validacao no salvar: min/max fazem o navegador marcar o
 * campo como invalido, mas nao impedem por si so que o formulario seja enviado.
 */

const ano = () => new Date().getFullYear()
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Nascimento: de 1920 ate hoje. Ninguem nasce amanha. */
export const NASCIMENTO = {
  get min() { return '1920-01-01' },
  get max() { return iso(new Date()) },
}

/**
 * Evento e reserva NOVOS: de hoje ate cinco anos a frente. Nao se agenda para tras —
 * data no passado em cadastro novo e sempre engano de digitacao.
 */
export const AGENDA = {
  get min() { return iso(new Date()) },
  get max() { return `${ano() + 5}-12-31` },
}

/**
 * Ao EDITAR, o limite de tras cai: evento que ja aconteceu precisa poder ter a data
 * corrigida, e fechamento acontece depois da festa. Aqui a guarda serve so contra ano
 * absurdo, nao contra o passado.
 */
export const AGENDA_EDICAO = {
  get min() { return `${ano() - 3}-01-01` },
  get max() { return `${ano() + 5}-12-31` },
}

/**
 * Diz se uma data cabe na faixa. String vazia passa — campo opcional vazio nao e
 * erro; quem exige preenchimento checa isso separado.
 */
export function dataPlausivel(valor: string, faixa: { min: string; max: string }): boolean {
  const v = (valor ?? '').trim()
  if (!v) return true
  return v >= faixa.min && v <= faixa.max
}
