import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { fmtCurrency } from '../utils/format'
import { NightPassBar } from './TicketPublic'

// Retorno do Checkout Pro: /pagamento/[order_id]
// O comprador volta do Mercado Pago aqui. A confirmação NÃO vem por esta tela — quem
// confirma é o webhook, que rebusca o pagamento na API do MP. Aqui só acompanhamos o
// pedido até virar pago e então mostramos o link do ingresso.
//
// Cartão pode ficar "em análise" (antifraude) por minutos ou horas; por isso a tela
// precisa desse terceiro estado, senão o comprador acha que a compra falhou.

interface Ordem {
  order_id: string; buyer_name: string; quantity: number
  amount_cents: number; payment_status: string; batch_name?: string
}

export function PagamentoRetornoPage({ orderId }: { orderId: string }) {
  const [ordem, setOrdem] = useState<Ordem | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [esperando, setEsperando] = useState(0)   // segundos aguardando confirmação
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    document.title = 'NightPass Tickets — Pagamento'
    let vivo = true

    async function checar() {
      const { data } = await supabase.rpc('get_order_public', { p_order_id: orderId })
      const o = (data?.[0] ?? null) as Ordem | null
      if (!vivo) return
      setOrdem(o); setCarregando(false)
      if (o?.payment_status === 'paid') {
        const { data: tks } = await supabase.rpc('get_tickets_by_order', { p_order_id: orderId })
        const primeiro = (tks ?? [])[0] as { token?: string } | undefined
        if (primeiro?.token) setToken(primeiro.token)
        if (timer.current) clearInterval(timer.current)
      }
    }

    checar()
    timer.current = setInterval(() => { setEsperando(s => s + 4); checar() }, 4000)
    return () => { vivo = false; if (timer.current) clearInterval(timer.current) }
  }, [orderId])

  const wrap = { minHeight: '100vh', background: C.bg, padding: '0 0 40px' }
  const caixa = { maxWidth: 420, margin: '0 auto', padding: '28px 16px 0', textAlign: 'center' as const }

  if (carregando) return (
    <div style={wrap}><NightPassBar />
      <div style={caixa}><div style={{ color: C.mut, fontSize: 15, padding: 40 }}>Verificando pagamento…</div></div>
    </div>
  )

  if (!ordem) return (
    <div style={wrap}><NightPassBar />
      <div style={caixa}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🔎</div>
        <div style={{ color: C.txt, fontSize: 19, fontWeight: 800 }}>Pedido não encontrado</div>
        <div style={{ color: C.mut, fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
          Confira se o link foi aberto por inteiro. Se você já pagou, procure a casa com o seu nome.
        </div>
      </div>
    </div>
  )

  const pago = ordem.payment_status === 'paid'
  const cancelado = ordem.payment_status === 'cancelled'

  return (
    <div style={wrap}>
      <NightPassBar />
      <div style={caixa}>
        <div style={{ fontSize: 48, marginBottom: 10 }}>{pago ? '✅' : cancelado ? '❌' : '⏳'}</div>
        <div style={{ color: pago ? C.grn : cancelado ? C.red : C.gold, fontSize: 21, fontWeight: 900 }}>
          {pago ? 'Pagamento confirmado!' : cancelado ? 'Pagamento não concluído' : 'Aguardando confirmação'}
        </div>

        {!pago && !cancelado && (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 10, lineHeight: 1.6 }}>
            {esperando < 30
              ? 'Isso costuma levar alguns segundos. Pode deixar esta tela aberta.'
              : 'Pagamento com cartão às vezes passa por análise e pode demorar. Assim que for aprovado, enviamos seu ingresso por WhatsApp — você pode fechar esta tela.'}
          </div>
        )}

        {cancelado && (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 10, lineHeight: 1.6 }}>
            A compra não foi concluída e nenhum valor foi cobrado. Você pode tentar de novo pelo link do evento.
          </div>
        )}

        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 16, marginTop: 20, textAlign: 'left' as const }}>
          <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>RESUMO</div>
          {[
            ['Titular', ordem.buyer_name],
            ['Ingresso', `${ordem.batch_name ?? ''} × ${ordem.quantity}`],
            ['Total', fmtCurrency(ordem.amount_cents)],
            ['Pedido', `#${ordem.order_id.slice(0, 8).toUpperCase()}`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
              <span style={{ color: C.sub, fontSize: 13 }}>{k}</span>
              <span style={{ color: C.txt, fontSize: 13, fontWeight: 600, textAlign: 'right' as const }}>{v}</span>
            </div>
          ))}
        </div>

        {pago && token && (
          <a href={`/ingresso/${token}`}
            style={{ display: 'block', marginTop: 16, background: C.grn, color: '#062', borderRadius: 12, padding: '14px 0', fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>
            🎫 Abrir meu ingresso
          </a>
        )}

        {pago && !token && (
          <div style={{ color: C.mut, fontSize: 13, marginTop: 16 }}>Gerando seu ingresso…</div>
        )}

        <div style={{ color: C.mut, fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
          Também enviamos o ingresso por WhatsApp assim que o pagamento é confirmado.
        </div>
      </div>
    </div>
  )
}
