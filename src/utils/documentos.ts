import type { House } from '../types'

/**
 * Documentos da casa (termo de imagem e o que vier depois).
 *
 * O modelo vive no banco com marcadores `{{...}}`. Ao gerar para uma pessoa, o texto
 * é preenchido e **arquivado como está** em `signed_documents.body_snapshot` — nunca
 * como referência ao modelo. Se guardássemos só o id, editar o modelo depois mudaria
 * retroativamente aquilo que a pessoa assinou, e o arquivo deixaria de provar nada.
 */

export interface DocTemplate {
  id: string
  house_id: string | null
  kind: string
  title: string
  body: string
  version: number
}

export interface DocAssinado {
  id: string
  freelancer_id: string | null
  kind: string
  title: string
  status: string
  signed_at?: string | null
  signed_method?: string | null
  revoked_at?: string | null
  created_at?: string
}

export interface PessoaDoc {
  full_name: string
  address?: string | null
  staff_type?: string | null
  cpf?: string | null
}

/** Valores padrão dos prazos — ficam à vista para o gestor conferir antes de imprimir. */
export const PADROES = {
  prazo_pos_vinculo: '2 (dois) anos',
  prazo_revogacao: '30 (trinta) dias',
}

const VINCULO: Record<string, string> = {
  funcionario: 'Funcionário(a)',
  freelancer: 'Freelancer / prestador(a) de serviço',
}

/** Troca os marcadores pelo dado real. O que faltar vira uma linha para preencher à mão. */
export function preencher(
  corpo: string,
  casa: House & { cnpj?: string | null; address?: string | null; email?: string | null; phone?: string | null; city?: string | null },
  pessoa: PessoaDoc,
  extras: Record<string, string> = {},
): string {
  const linha = '________________________'
  const contato = [casa.email, casa.phone].filter(Boolean).join(' · ') || linha
  const valores: Record<string, string> = {
    'casa.nome': casa.name || linha,
    'casa.cnpj': casa.cnpj || linha,
    'casa.endereco': casa.address || linha,
    'casa.contato': contato,
    'casa.cidade': casa.city || linha,
    'pessoa.nome': pessoa.full_name || linha,
    'pessoa.cpf': pessoa.cpf || linha,
    'pessoa.endereco': pessoa.address || linha,
    'pessoa.vinculo': VINCULO[pessoa.staff_type ?? ''] ?? linha,
    foro: casa.city || linha,
    ...PADROES,
    ...extras,
  }
  return corpo.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_, chave: string) => valores[chave] ?? linha)
}

/** Quais marcadores ficaram sem dado — o gestor precisa saber ANTES de mandar assinar. */
export function faltando(
  corpo: string,
  casa: Parameters<typeof preencher>[1],
  pessoa: PessoaDoc,
): string[] {
  const preenchido = preencher(corpo, casa, pessoa)
  const rotulos: Record<string, string> = {
    'casa.nome': 'nome da casa', 'casa.cnpj': 'CNPJ', 'casa.endereco': 'endereço da casa',
    'casa.cidade': 'cidade', 'pessoa.cpf': 'CPF da pessoa', 'pessoa.endereco': 'endereço da pessoa',
    'pessoa.vinculo': 'tipo de vínculo',
  }
  const faltas: string[] = []
  for (const [chave, rotulo] of Object.entries(rotulos)) {
    if (!corpo.includes(`{{${chave}}}`)) continue
    const so = preencher(`{{${chave}}}`, casa, pessoa)
    if (so.startsWith('____')) faltas.push(rotulo)
  }
  // o texto preenchido ainda pode ter linhas em branco de outros marcadores
  void preenchido
  return faltas
}

/** Markdown simples → HTML da folha. Só o que o modelo usa: ##, ###, **, listas e parágrafos. */
export function paraHtmlImpressao(titulo: string, corpo: string, rodape: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const blocos = corpo.trim().split(/\n{2,}/).map(b => {
    const t = b.trim()
    if (t.startsWith('### ')) return `<h3>${esc(t.slice(4))}</h3>`
    if (t.startsWith('## ')) return `<h2>${esc(t.slice(3))}</h2>`
    if (t.startsWith('- ')) {
      const itens = t.split('\n').filter(l => l.trim().startsWith('- '))
        .map(l => `<li>${negrito(esc(l.replace(/^\s*-\s*/, '')))}</li>`).join('')
      return `<ul>${itens}</ul>`
    }
    return `<p>${negrito(esc(t)).replace(/\n/g, '<br>')}</p>`
  }).join('\n')

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { margin: 20mm 18mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; font-size: 11.5pt; line-height: 1.55; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 18px; text-transform: uppercase; letter-spacing: .02em; }
  h2 { font-size: 12pt; margin: 18px 0 8px; }
  h3 { font-size: 11.5pt; margin: 16px 0 6px; }
  p { margin: 0 0 10px; text-align: justify; }
  ul { margin: 0 0 10px 18px; padding: 0; }
  li { margin-bottom: 4px; }
  .assin { margin-top: 46px; display: flex; gap: 40px; }
  .assin div { flex: 1; text-align: center; border-top: 1px solid #111; padding-top: 6px; font-size: 10pt; }
  .test { margin-top: 34px; display: flex; gap: 40px; }
  .test div { flex: 1; border-top: 1px solid #111; padding-top: 6px; font-size: 9.5pt; }
  .rodape { margin-top: 26px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 8pt; color: #666; text-align: center; }
  h2, h3 { break-after: avoid; page-break-after: avoid; }
</style></head><body>
<h1>${esc(titulo)}</h1>
${blocos}
<div class="assin">
  <div><b>CASA</b></div>
  <div><b>COLABORADOR(A)</b></div>
</div>
<div class="test">
  <div>Testemunha — Nome / CPF</div>
  <div>Testemunha — Nome / CPF</div>
</div>
<div class="rodape">${esc(rodape)}</div>
<script>window.onload = () => window.print()</script>
</body></html>`
}

function negrito(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}
