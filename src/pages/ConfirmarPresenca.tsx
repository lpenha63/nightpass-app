import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#0a0e1a', card: '#111827', brd: '#1e2736',
  acc: '#3b82f6', grn: '#10b981', red: '#f87171',
  gold: '#f59e0b', txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af',
}

interface GuestInfo {
  id: string
  full_name: string
  phone?: string
  is_vip?: boolean
  max_plus_ones?: number
  confirmed_at?: string
  invited_by?: string
  list_id: string
  house_id: string
  event_id: string
  promoter_id: string
  events?: { name: string; event_date: string; start_time?: string; flyer_url?: string }
  houses?: { name: string; logo_url?: string }
}

export function ConfirmarPresencaPage({ token }: { token: string }) {
  const [guest, setGuest] = useState<GuestInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [listToken, setListToken] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('promoter_list_guests')
        .select('*,events(name,event_date,start_time,flyer_url),houses(name,logo_url)')
        .eq('invite_token', token)
        .single()
      if (!data) { setNotFound(true); setLoading(false); return }
      setGuest(data as GuestInfo)
      if (data.confirmed_at) setConfirmed(true)
      // Busca o token da lista para gerar link de convite de amigos
      const { data: listData } = await supabase
        .from('promoter_lists')
        .select('token')
        .eq('id', data.list_id)
        .single()
      if (listData?.token) setListToken(listData.token)
      setLoading(false)
    }
    load()
  }, [token])

  async function confirmPresence() {
    if (!guest || confirmed) return
    setConfirming(true)
    await supabase.from('promoter_list_guests')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('id', guest.id)
    setConfirmed(true)
    setConfirming(false)
  }

  function friendLink() {
    // Link da lista com atribuição ao convidado que indicou (ref = id do guest)
    return `${window.location.origin}/lista/${listToken}?ref=${guest?.id ?? ''}`
  }

  function shareFriendsWA() {
    if (!guest) return
    const ev = guest.events
    const dateStr = ev?.event_date
      ? new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
      : ''
    const msg = `🎉 Bora pra *${ev?.name}* — ${dateStr}?\n\nTô te colocando na lista! Confirme seus dados aqui:\n${friendLink()}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function copyFriendLink() {
    try {
      await navigator.clipboard.writeText(friendLink())
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* ignore */ }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mut, fontFamily: 'system-ui,sans-serif' }}>
      Carregando...
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', padding: 24 }}>
      <div style={{ textAlign: 'center', color: C.mut }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>😕</div>
        <div style={{ fontSize: 18, color: C.txt, fontWeight: 700, marginBottom: 8 }}>Link inválido ou expirado</div>
        <div style={{ fontSize: 14 }}>Entre em contato com o organizador.</div>
      </div>
    </div>
  )

  if (!guest) return null

  const ev = guest.events
  const house = guest.houses
  const dateStr = ev?.event_date
    ? new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    : ''
  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: 'system-ui,sans-serif', padding: '0 0 60px' }}>
      {/* Flyer */}
      {ev?.flyer_url && (
        <div style={{ width: '100%', maxHeight: 300, overflow: 'hidden' }}>
          <img src={ev.flyer_url} alt={ev.name} style={{ width: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px' }}>
        {/* Logo + casa */}
        {house && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            {house.logo_url && <img src={house.logo_url} alt={house.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />}
            <span style={{ color: C.mut, fontSize: 13, fontWeight: 600 }}>{house.name}</span>
          </div>
        )}

        {/* Evento */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ color: C.txt, fontSize: 24, fontWeight: 900, margin: '0 0 6px' }}>{ev?.name}</h1>
          <div style={{ color: C.mut, fontSize: 14 }}>
            📅 {dateStr}{ev?.start_time ? ` · ${ev.start_time.slice(0, 5)}` : ''}
          </div>
          {guest.is_vip && (
            <div style={{ display: 'inline-block', marginTop: 8, background: C.gold + '22', border: `1px solid ${C.gold}44`, borderRadius: 8, padding: '4px 12px', color: C.gold, fontSize: 12, fontWeight: 700 }}>
              ⭐ Entrada VIP
            </div>
          )}
        </div>

        {/* Card confirmação */}
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>👋</div>
          <div style={{ color: C.txt, fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{guest.full_name}</div>
          <div style={{ color: C.mut, fontSize: 13, marginBottom: 20 }}>Você está na lista da casa!</div>

          {confirmed ? (
            <div style={{ background: C.grn + '15', border: `1px solid ${C.grn}33`, borderRadius: 12, padding: '16px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
              <div style={{ color: C.grn, fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Presença confirmada!</div>
              <div style={{ color: C.mut, fontSize: 13 }}>Apresente este link na entrada.</div>
            </div>
          ) : (
            <button onClick={confirmPresence} disabled={confirming}
              style={{ width: '100%', background: `linear-gradient(135deg,${C.grn},#059669)`, border: 'none', borderRadius: 12, padding: '16px', color: '#fff', fontSize: 17, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
              {confirming ? 'Confirmando...' : '✅ Confirmar minha presença'}
            </button>
          )}
        </div>

        {/* Convidar amigos — compartilhar link */}
        {confirmed && (guest.max_plus_ones ?? 0) > 0 && listToken && (
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 800, color: C.txt, fontSize: 16, marginBottom: 4 }}>👥 Convide seus amigos</div>
            <div style={{ color: C.mut, fontSize: 13, marginBottom: 16 }}>
              Você pode levar até <strong style={{ color: C.acc }}>{guest.max_plus_ones} amigo{(guest.max_plus_ones ?? 0) !== 1 ? 's' : ''}</strong>.
              Envie o link abaixo — eles confirmam a presença em poucos segundos.
            </div>

            <button onClick={shareFriendsWA}
              style={{ width: '100%', background: '#25D366', border: 'none', borderRadius: 12, padding: '14px', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              📲 Enviar pelo WhatsApp
            </button>

            <button onClick={copyFriendLink}
              style={{ width: '100%', background: copied ? C.grn + '22' : C.acc + '15', border: `1px solid ${copied ? C.grn : C.acc}44`, borderRadius: 12, padding: '13px', color: copied ? C.grn : C.acc, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {copied ? '✅ Link copiado!' : '🔗 Copiar link de convite'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
