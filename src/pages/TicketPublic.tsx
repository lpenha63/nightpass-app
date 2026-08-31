import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'

// Recuperação do ingresso: /ingresso/[token]
// Antes o QR só existia na tela de confirmação da compra ("salve essa tela!") — fechou o
// navegador, perdeu o ingresso. Este link é enviado por WhatsApp e pode ser reaberto sempre.
// A leitura é por RPC (get_ticket_by_token): a tabela `tickets` não é legível por anônimo,
// senão daria para listar todos os tokens e forjar um QR válido.

interface TicketInfo {
  ticket_id: string
  token: string
  holder_name: string
  checked_in: boolean
  checked_in_at: string | null
  event_name: string
  event_date: string
  start_time: string | null
  end_time: string | null
  flyer_url: string | null
  house_name: string
  batch_name: string | null
  batch_gender: string | null
  buyer_name: string | null
  buyer_cpf_mask: string | null
  order_code: string | null
  quantity: number | null
  ordem: number
  payment_status: string | null
  house_address: string | null
  house_city: string | null
  house_state: string | null
  house_phone: string | null
}

const GENERO: Record<string, string> = { both: 'Misto', male: 'Masculino', female: 'Feminino' }

export function TicketPublicPage({ token }: { token: string }) {
  const [tk, setTk] = useState<TicketInfo | null>(null)
  const [irmaos, setIrmaos] = useState<{ token: string; checked_in: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    supabase.rpc('get_ticket_by_token', { p_token: token }).then(async r => {
      const info = (r.data?.[0] ?? null) as TicketInfo | null
      setTk(info)
      setLoading(false)
      if (info) document.title = `NightPass Tickets — ${info.event_name}`
      // Compra de vários ingressos: deixa folhear todos pelo mesmo link
      if (info && (info.quantity ?? 1) > 1) {
        const { data } = await supabase.rpc('get_tickets_by_order_from_token', { p_token: token })
        const lista = (data ?? []) as { token: string; checked_in: boolean }[]
        setIrmaos(lista)
        const i = lista.findIndex(x => x.token === token)
        if (i >= 0) setIdx(i)
      }
    })
  }, [token])

  const wrap = { minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }

  if (loading) return <div style={wrap}><span style={{ color: C.mut, fontSize: 15 }}>Carregando ingresso...</span></div>

  if (!tk) return (
    <div style={wrap}>
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🎫</div>
        <div style={{ color: C.txt, fontSize: 19, fontWeight: 800, marginBottom: 8 }}>Ingresso não encontrado</div>
        <div style={{ color: C.mut, fontSize: 14, lineHeight: 1.5 }}>
          Confira se o link foi copiado inteiro. Se o problema continuar, procure a casa com o nome do comprador.
        </div>
      </div>
    </div>
  )

  const atual = irmaos.length > 1 ? irmaos[idx] : { token: tk.token, checked_in: tk.checked_in }
  const usado = atual.checked_in
  const dataFmt = new Date(tk.event_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  // Comparacao por string ISO (YYYY-MM-DD) — nao sofre com fuso nem com hora local.
  const hojeIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const venceu = tk.event_date < hojeIso
  const total = irmaos.length > 1 ? irmaos.length : (tk.quantity ?? 1)
  const numero = irmaos.length > 1 ? idx + 1 : tk.ordem

  // Endereço da casa. Nem toda unidade tem cadastrado, então tudo aqui é condicional —
  // ingresso com "Endereço: —" é pior do que ingresso sem a linha.
  const endereco = [tk.house_address, [tk.house_city, tk.house_state].filter(Boolean).join(' - ')]
    .filter(Boolean).join(', ')
  const mapa = endereco
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${tk.house_name}, ${endereco}`)}`
    : null
  const foneDigitos = (tk.house_phone ?? '').replace(/\D/g, '')

  const linha = (rot: string, val: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: `1px solid ${C.brd}55` }}>
      <span style={{ color: C.mut, fontSize: 12 }}>{rot}</span>
      <span style={{ color: C.txt, fontSize: 12, fontWeight: 600, textAlign: 'right' as const }}>{val}</span>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '0 0 40px' }}>
      <NightPassBar />
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '20px 16px 0' }}>

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ color: C.mut, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>{tk.house_name.toUpperCase()}</div>
          <div style={{ color: C.txt, fontSize: 22, fontWeight: 900, marginTop: 4 }}>{tk.event_name}</div>
          <div style={{ color: C.sub, fontSize: 14, marginTop: 4, textTransform: 'capitalize' as const }}>
            {dataFmt}{tk.start_time ? ` · ${tk.start_time.slice(0, 5)}` : ''}
            {tk.end_time ? ` às ${tk.end_time.slice(0, 5)}` : ''}
          </div>
        </div>

        {tk.payment_status === 'pending' && (
          <div style={{ background: C.gold + '18', border: `1px solid ${C.gold}55`, borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: C.gold, fontSize: 13, textAlign: 'center' as const }}>
            ⏳ Pagamento ainda não confirmado. O QR só vale depois da confirmação.
          </div>
        )}

        <div style={{ background: C.card, border: `1px solid ${usado ? C.brd : C.grn + '44'}`, borderRadius: 20, padding: 24, textAlign: 'center' as const }}>
          {/* Tipo do ingresso em destaque: é o que define onde a pessoa entra (pista, camarote, VIP) */}
          {tk.batch_name && (
            <div style={{ display: 'inline-block', background: C.acc + '1f', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 999, padding: '5px 16px', fontSize: 13, fontWeight: 800, letterSpacing: .3, marginBottom: 14 }}>
              {tk.batch_name}
              {tk.batch_gender && tk.batch_gender !== 'both' ? ` · ${GENERO[tk.batch_gender]}` : ''}
            </div>
          )}

          <div style={{ color: usado ? C.mut : C.grn, fontWeight: 700, fontSize: 12, marginBottom: 12 }}>
            🎫 Ingresso {total > 1 ? `${numero} de ${total}` : 'único'}
          </div>

          {/* A margem branca (zona silenciosa) do QR precisa ter ao menos 4 modulos.
              Com 190px / 29 modulos, cada modulo tem ~6,5px — os 12px de antes davam
              menos de 2, e leitor de celular falha justamente por isso. 28px = ~4,3. */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, display: 'inline-block', position: 'relative' as const }}>
            <QRCode value={atual.token} size={200} />
            {usado && (
              <div style={{ position: 'absolute' as const, inset: 0, background: 'rgba(10,14,26,0.82)', borderRadius: 12, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <div style={{ fontSize: 30 }}>✅</div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>JÁ UTILIZADO</div>
              </div>
            )}
          </div>

          {/* Validade explicita: o ingresso so entra na data do evento. Sem isto o
              portador nao tinha como saber, e na porta virava discussao. */}
          <div style={{ color: venceu ? '#f87171' : C.mut, fontSize: 12.5, fontWeight: 700, marginTop: 12 }}>
            {venceu ? '⚠️ Data vencida — ' : ''}Válido somente em {new Date(tk.event_date + 'T12:00:00').toLocaleDateString('pt-BR')}
          </div>

          <div style={{ color: C.mut, fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.1em', marginTop: 8 }}>
            {atual.token.slice(0, 8).toUpperCase()}
          </div>
        </div>

        {irmaos.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              style={navBtn(idx === 0)}>‹</button>
            <span style={{ color: C.sub, fontSize: 13, fontWeight: 600 }}>{idx + 1} de {irmaos.length}</span>
            <button onClick={() => setIdx(i => Math.min(irmaos.length - 1, i + 1))} disabled={idx === irmaos.length - 1}
              style={navBtn(idx === irmaos.length - 1)}>›</button>
          </div>
        )}

        {/* Onde é. O ingresso é repassado no WhatsApp e aberto por quem talvez nunca
            tenha ido na casa — e, com mais de uma unidade na conta, o nome não basta. */}
        {endereco && (
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: '14px 18px', marginTop: 16 }}>
            <div style={{ color: C.mut, fontSize: 10, fontWeight: 800, letterSpacing: .6, marginBottom: 8 }}>ONDE É</div>
            <div style={{ color: C.txt, fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{tk.house_name}</div>
            <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.5 }}>{endereco}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' as const }}>
              {mapa && (
                <a href={mapa} target="_blank" rel="noopener noreferrer"
                  style={{ flex: '1 1 140px', textAlign: 'center' as const, background: C.acc + '1f', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                  📍 Como chegar
                </a>
              )}
              {foneDigitos.length >= 10 && (
                <a href={`https://wa.me/55${foneDigitos}`} target="_blank" rel="noopener noreferrer"
                  style={{ flex: '1 1 140px', textAlign: 'center' as const, background: 'transparent', border: `1px solid ${C.brd}`, color: C.sub, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                  💬 Falar com a casa
                </a>
              )}
            </div>
          </div>
        )}

        {/* Identificação do titular — é o que a portaria confere contra o documento */}
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: '14px 18px', marginTop: 16 }}>
          <div style={{ color: C.mut, fontSize: 10, fontWeight: 800, letterSpacing: .6, marginBottom: 6 }}>TITULAR DO INGRESSO</div>
          {linha('Nome', tk.buyer_name ?? tk.holder_name)}
          {tk.buyer_cpf_mask && linha('CPF', tk.buyer_cpf_mask)}
          {linha('Tipo', tk.batch_name ?? '—')}
          {linha('Evento', tk.event_name)}
          {!endereco && linha('Local', tk.house_name)}
          {tk.order_code && linha('Pedido', `#${tk.order_code}`)}
        </div>

        <div style={{ background: C.gold + '12', border: `1px solid ${C.gold}33`, borderRadius: 12, padding: '11px 14px', marginTop: 12, color: C.gold, fontSize: 11.5, lineHeight: 1.5 }}>
          🔒 Ingresso pessoal. Na entrada pode ser exigido <b>documento com foto</b> do titular.
          Cada QR só permite uma entrada.
        </div>

        <div style={{ color: C.mut, fontSize: 12, textAlign: 'center' as const, marginTop: 18, lineHeight: 1.6 }}>
          Salve este link — ele abre o ingresso a qualquer momento.
        </div>
      </div>
    </div>
  )
}

/** Barra de identidade do produto — dá ao comprador a referência de quem emitiu o ingresso */
export function NightPassBar() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '11px 16px', background: C.card, borderBottom: `1px solid ${C.brd}`,
    }}>
      <span style={{ fontSize: 15 }}>🎫</span>
      <span style={{ color: C.txt, fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em' }}>
        NightPass <span style={{ color: C.acc }}>Tickets</span>
      </span>
      <span style={{ color: C.mut, fontSize: 11, marginLeft: 6 }}>· compra segura</span>
    </div>
  )
}

function navBtn(off: boolean) {
  return {
    background: C.card, border: `1px solid ${C.brd}`, color: off ? C.brd : C.txt,
    borderRadius: 10, width: 40, height: 36, fontSize: 20, lineHeight: 1,
    cursor: off ? 'default' : 'pointer', fontFamily: 'inherit',
  }
}
