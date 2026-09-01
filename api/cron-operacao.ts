import type { VercelRequest, VercelResponse } from '@vercel/node'
import { admin } from './_gateways.js'

/**
 * Cria o Dia de Operacao das casas que abrem sem evento, e escala os funcionarios
 * fixos nele.
 *
 * Ate aqui isso so acontecia se alguem abrisse a tela de Eventos e clicasse no botao —
 * ou seja, a funcionalidade existia e nao rodava sozinha, que era o ponto dela.
 *
 * Regras, todas vindas do cadastro da casa (Configuracoes -> Funcionamento):
 *   - so casas com auto_operation = true;
 *   - so nos dias listados em open_days ('seg'..'dom');
 *   - nunca sobrepoe um evento ja marcado para a data — evento de verdade manda,
 *     e o dia de operacao e o preenchimento do vazio;
 *   - horario vem de open_time/close_time da casa, nao de um 18h-02h fixo: padaria
 *     abre 6h, restaurante 11h.
 *
 * Escala dos fixos: entra quem tem staff_type = 'funcionario' e trabalha nesse dia.
 * Quem nao tem dias marcados no cadastro trabalha em TODO dia de funcionamento —
 * e o significado de ser fixo, e exigir o preenchimento faria a escala sair vazia
 * justamente em quem mais aparece.
 */

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const

/** Data de hoje no fuso da casa. O cron roda em UTC; sem isto, das 21h a meia-noite
 *  em Brasilia o servidor ja estaria no dia seguinte. */
function hojeEmSaoPaulo(): { iso: string; dia: string } {
  const agora = new Date()
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora)
  const d = new Date(iso + 'T12:00:00Z')
  return { iso, dia: DIAS[d.getUTCDay()] }
}

interface Casa {
  id: string; name: string
  open_days: string[] | null; open_time: string | null; close_time: string | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // O cron da Vercel chama por HTTP GET numa URL publica. Sem esta checagem, qualquer
  // um poderia dispara-lo e encher a agenda de dias de operacao.
  const segredo = process.env.CRON_SECRET
  if (segredo) {
    const auth = String(req.headers.authorization ?? '')
    if (auth !== `Bearer ${segredo}`) return res.status(401).json({ error: 'Nao autorizado' })
  }

  const { iso, dia } = hojeEmSaoPaulo()
  const sb = admin()

  const { data: casas, error } = await sb
    .from('houses')
    .select('id,name,open_days,open_time,close_time')
    .eq('auto_operation', true)
  if (error) return res.status(500).json({ error: error.message })

  const relatorio: Array<Record<string, unknown>> = []

  for (const casa of (casas ?? []) as Casa[]) {
    if (!casa.open_days?.includes(dia)) {
      relatorio.push({ casa: casa.name, acao: 'fechada hoje', dia })
      continue
    }

    // Evento marcado tem precedencia. Cancelado nao conta: a casa pode ter cancelado
    // a festa e ainda assim querer abrir.
    const { data: existente } = await sb.from('events')
      .select('id,name').eq('house_id', casa.id).eq('event_date', iso)
      .neq('status', 'cancelado').limit(1).maybeSingle()
    if (existente) {
      relatorio.push({ casa: casa.name, acao: 'ja tem evento', evento: existente.name })
      continue
    }

    const rotulo = new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', timeZone: 'UTC',
    })
    const { data: novo, error: erroEv } = await sb.from('events').insert({
      house_id: casa.id,
      name: `Operação — ${rotulo}`,
      event_date: iso,
      genre: 'Operação',
      start_time: (casa.open_time ?? '18:00').slice(0, 5),
      end_time: (casa.close_time ?? '02:00').slice(0, 5),
      status: 'ativo',
      is_operation: true,
      price_male_cents: 0, price_female_cents: 0,
      price_male_list_cents: 0, price_female_list_cents: 0,
    }).select('id').single()

    if (erroEv || !novo) {
      relatorio.push({ casa: casa.name, acao: 'falhou', erro: erroEv?.message })
      continue
    }

    // ── Escala dos fixos ──
    const { data: fixos } = await sb.from('freelancers')
      .select('id,full_name,work_types,work_meta')
      .eq('house_id', casa.id).eq('status', 'ativo').eq('staff_type', 'funcionario')

    const escalar = ((fixos ?? []) as Array<{
      id: string; full_name: string; work_types: string[] | null
      work_meta: { work_days?: string[] | null } | null
    }>).filter(f => {
      const dias = f.work_meta?.work_days
      return !dias || dias.length === 0 || dias.includes(dia)
    })

    if (escalar.length > 0) {
      const { error: erroEsc } = await sb.from('event_freelancers').insert(
        escalar.map(f => ({
          event_id: novo.id,
          freelancer_id: f.id,
          confirmed: false,
          role: f.work_types?.[0] ?? null,
        })),
      )
      if (erroEsc) relatorio.push({ casa: casa.name, acao: 'criado, escala falhou', erro: erroEsc.message })
    }

    relatorio.push({ casa: casa.name, acao: 'criado', data: iso, escalados: escalar.length })
  }

  return res.status(200).json({ ok: true, dia, data: iso, casas: relatorio })
}
