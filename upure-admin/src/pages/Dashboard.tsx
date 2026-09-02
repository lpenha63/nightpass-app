import { useState, useEffect } from 'react'
import { sb } from '../lib/supabase'
import { C, card } from '../theme'
import { Kpi, Empty } from '../components/ui'
import { money } from '../format'

/**
 * Paleta categórica (produtos) — validada com scripts/validate_palette.js
 * em superfície #0f1526/dark: faixa de luminosidade, chroma, CVD e contraste PASS;
 * separação CVD fica no piso 6–8, o que só é permitido COM rótulo direto —
 * por isso todo produto aparece sempre com o nome escrito ao lado da barra.
 * Ordem fixa: nunca ciclar nem recolorir por ranking.
 */
const CAT = ['#2563eb', '#ec4899', '#0d9488']

// Faixas de atraso: escala de status (não categórica) — sempre com rótulo em texto.
const AGING = [
  { key: 'a_vencer', label: 'A vencer', color: C.acc },
  { key: 'd1_30', label: '1–30 dias', color: C.gold },
  { key: 'd31_60', label: '31–60 dias', color: '#f97316' },
  { key: 'd60_mais', label: '60+ dias', color: C.red },
]

interface ProdRow { product_id: string; product_name: string; ativos: number; em_teste: number; cortesia: number; inadimplentes: number; mrr_cents: number }
interface AgingRow { faixa: string; qtd: number; total_cents: number }
interface MesRow { mes: string; total_cents: number }
interface DashData {
  mrr_cents: number; arr_cents: number
  ativos: number; em_teste: number; cortesia: number; inadimplentes: number
  novos_mes: number; cancelados_mes: number; churn_pct: number; conversao_trial_pct: number
  faturado_mes: number; recebido_mes: number; em_aberto_cents: number; vencido_cents: number
  por_produto: ProdRow[]; aging: AgingRow[]; receita_12m: MesRow[]
}

export function Dashboard() {
  const [d, setD] = useState<DashData | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    sb.rpc('saas_dashboard').then(r => {
      if (r.error) setErr(r.error.message)
      else setD(r.data as DashData)
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ color: C.mut, fontSize: 13, padding: 40, textAlign: 'center' }}>Carregando métricas…</div>
  if (err) return <div style={{ color: C.red, fontSize: 13, padding: 20 }}>⚠️ {err}</div>
  if (!d) return null

  return (
    <div>
      {/* Número herói — a métrica que resume o negócio */}
      <div style={{ ...card, marginBottom: 14, display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>RECEITA RECORRENTE MENSAL</div>
          <div style={{ color: C.grn, fontSize: 40, fontWeight: 900, lineHeight: 1.1 }}>{money(d.mrr_cents)}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: C.mut, fontSize: 11 }}>Projeção anual</div>
          <div style={{ color: C.sub, fontSize: 20, fontWeight: 800 }}>{money(d.arr_cents)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Kpi label="Assinantes ativos" val={String(d.ativos)} color={C.grn} />
        <Kpi label="Em teste" val={String(d.em_teste)} color={C.acc} sub={`conversão ${d.conversao_trial_pct}%`} />
        <Kpi label="Cortesia" val={String(d.cortesia)} color={C.vio} />
        <Kpi label="Inadimplentes" val={String(d.inadimplentes)} color={C.red} />
        <Kpi label="Churn no mês" val={`${d.churn_pct}%`} color={d.churn_pct > 5 ? C.red : C.mut} sub={`${d.cancelados_mes} cancelada(s)`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 22 }}>
        <Kpi label="Faturado no mês" val={money(d.faturado_mes)} color={C.sub} sub="competência" />
        <Kpi label="Recebido no mês" val={money(d.recebido_mes)} color={C.grn} sub="caixa" />
        <Kpi label="Em aberto" val={money(d.em_aberto_cents)} color={C.gold} />
        <Kpi label="Vencido" val={money(d.vencido_cents)} color={C.red} />
      </div>

      <RevenueChart data={d.receita_12m} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 22 }}>
        <ByProduct rows={d.por_produto} />
        <Aging rows={d.aging} />
      </div>
    </div>
  )
}

/** Receita recebida por mês. Série única → sem legenda (o título nomeia a série). */
function RevenueChart({ data }: { data: MesRow[] }) {
  const [hover, setHover] = useState<number | null>(null)

  if (!data.length) {
    return (
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>📈 Receita recebida (12 meses)</div>
        <Empty>Nenhum pagamento registrado ainda — o gráfico aparece após a primeira cobrança.</Empty>
      </div>
    )
  }

  const max = Math.max(...data.map(m => m.total_cents), 1)
  const maxIdx = data.findIndex(m => m.total_cents === max)
  const label = (mes: string) => {
    const [y, mo] = mes.split('-')
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' })
  }

  return (
    <div style={{ ...card, position: 'relative' }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 16 }}>📈 Receita recebida (12 meses)</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 160 }}>
        {data.map((m, i) => {
          const h = Math.max((m.total_cents / max) * 100, 1.5)
          const on = hover === i
          // rótulo direto só no pico e no mês corrente — nunca em todas as barras
          const showLabel = i === maxIdx || i === data.length - 1
          return (
            <div
              key={m.mes}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', cursor: 'default' }}>
              {(showLabel || on) && (
                <div style={{ fontSize: 10, color: on ? C.txt : C.mut, textAlign: 'center', marginBottom: 4, whiteSpace: 'nowrap', fontWeight: 700 }}>
                  {money(m.total_cents).replace('R$ ', '')}
                </div>
              )}
              <div
                style={{
                  height: `${h}%`,
                  background: on ? '#60a5fa' : CAT[0],
                  borderRadius: '4px 4px 0 0',   // ponta arredondada, base ancorada
                  transition: 'background .12s',
                }}
              />
              <div style={{ fontSize: 9, color: C.mut, textAlign: 'center', marginTop: 6 }}>{label(m.mes)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Receita por app — categórico. Nome sempre escrito: identidade nunca só por cor. */
function ByProduct({ rows }: { rows: ProdRow[] }) {
  const max = Math.max(...rows.map(r => r.mrr_cents), 1)
  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14 }}>🧩 Receita por app</div>
      {rows.length === 0 && <Empty>Nenhum app cadastrado.</Empty>}
      {rows.map((r, i) => (
        <div key={r.product_id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: CAT[i % CAT.length], flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{r.product_name}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.txt }}>{money(r.mrr_cents)}</span>
          </div>
          <div style={{ height: 7, background: C.bg, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(r.mrr_cents / max) * 100}%`, height: '100%', background: CAT[i % CAT.length], borderRadius: 4 }} />
          </div>
          <div style={{ color: C.mut, fontSize: 11, marginTop: 4 }}>
            {r.ativos} ativo(s) · {r.em_teste} em teste · {r.cortesia} cortesia
            {r.inadimplentes > 0 && <span style={{ color: C.red }}> · {r.inadimplentes} inadimplente(s)</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Inadimplência por faixa de atraso — escala de status, sempre rotulada em texto. */
function Aging({ rows }: { rows: AgingRow[] }) {
  const byKey = new Map(rows.map(r => [r.faixa, r]))
  const total = rows.reduce((t, r) => t + Number(r.total_cents), 0)

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14 }}>⏳ Faturas em aberto por atraso</div>
      {total === 0 && <Empty>Nenhuma fatura em aberto. 🎉</Empty>}
      {total > 0 && AGING.map(f => {
        const r = byKey.get(f.key)
        const val = Number(r?.total_cents ?? 0)
        return (
          <div key={f.key} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: f.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.sub, flex: 1 }}>{f.label}</span>
              <span style={{ fontSize: 12, color: C.mut }}>{r?.qtd ?? 0}×</span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{money(val)}</span>
            </div>
            <div style={{ height: 7, background: C.bg, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${total ? (val / total) * 100 : 0}%`, height: '100%', background: f.color, borderRadius: 4 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
