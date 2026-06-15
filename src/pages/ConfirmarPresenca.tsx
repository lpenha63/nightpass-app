import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#0a0e1a', card: '#111827', brd: '#1e2736',
  acc: '#3b82f6', grn: '#10b981', red: '#f87171',
  gold: '#f59e0b', txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af',
}

const INP: React.CSSProperties = {
  width: '100%', background: '#1f2937', border: `1px solid ${C.brd}`,
  borderRadius: 10, padding: '12px 14px', color: C.txt, fontSize: 15,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

function fmtPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (d.length >= 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return d
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
  const [showFriendForm, setShowFriendForm] = useState(false)
  const [friendForm, setFriendForm] = useState({ name: '', phone: '', gender: '' })
  const [friendDone, setFriendDone] = useState(false)
  const [friendSending, setFriendSending] = useState(false)
  const [friendsAdded, setFriendsAdded] = useState(0)
  const [plusOnesCount, setPlusOnesCount] = useState(0)

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
      // Count existing plus ones
      const { count } = await supabase
        .from('promoter_list_guests')
        .select('id', { count: 'exact', head: true })
        .eq('invited_by', data.id)
      setPlusOnesCount(count ?? 0)
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

  async function addFriend() {
    if (!guest || !friendForm.name.trim()) return
    const maxAllowed = guest.max_plus_ones ?? 0
    if (maxAllowed === 0) return
    if (plusOnesCount >= maxAllowed) return
    setFriendSending(true)
    await supabase.from('promoter_list_guests').insert({
      list_id: guest.list_id,
      house_id: guest.house_id,
      event_id: guest.event_id,
      promoter_id: guest.promoter_id,
      full_name: friendForm.name.trim(),
      phone: friendForm.phone.replace(/\D/g, '') || null,
      gender: friendForm.gender || null,
      list_type: 'promoter',
      is_vip: false,
      promoter_confirmed: true,
      invited_by: guest.id,
      confirmed_at: new Date().toISOString(),
    })
    setPlusOnesCount(p => p + 1)
    setFriendsAdded(p => p + 1)
    setFriendForm({ name: '', phone: '', gender: '' })
    setFriendSending(false)
    setFriendDone(true)
    setTimeout(() => setFriendDone(false), 3000)
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
  const canInvite = (guest.max_plus_ones ?? 0) > 0 && plusOnesCount < (guest.max_plus_ones ?? 0)
  const spotsLeft = (guest.max_plus_ones ?? 0) - plusOnesCount

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

        {/* Convidar amigos */}
        {confirmed && (guest.max_plus_ones ?? 0) > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 800, color: C.txt, fontSize: 16, marginBottom: 4 }}>👥 Convidar amigos</div>
            <div style={{ color: C.mut, fontSize: 13, marginBottom: 16 }}>
              Você pode trazer <strong style={{ color: C.acc }}>{spotsLeft} amigo{spotsLeft !== 1 ? 's' : ''}</strong> ainda.
              {friendsAdded > 0 && <span style={{ color: C.grn }}> ({friendsAdded} adicionado{friendsAdded !== 1 ? 's' : ''})</span>}
            </div>

            {canInvite ? (
              <>
                {!showFriendForm ? (
                  <button onClick={() => setShowFriendForm(true)}
                    style={{ width: '100%', background: C.acc + '22', border: `1px solid ${C.acc}44`, borderRadius: 12, padding: '14px', color: C.acc, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ➕ Adicionar amigo
                  </button>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <input style={INP} placeholder="Nome do amigo *" value={friendForm.name}
                      onChange={e => setFriendForm(p => ({ ...p, name: e.target.value }))} />
                    <input style={INP} placeholder="Celular (opcional)" value={fmtPhone(friendForm.phone)}
                      onChange={e => setFriendForm(p => ({ ...p, phone: e.target.value }))} />
                    <select style={{ ...INP }} value={friendForm.gender} onChange={e => setFriendForm(p => ({ ...p, gender: e.target.value }))}>
                      <option value="">Gênero (opcional)</option>
                      <option value="M">♂ Masculino</option>
                      <option value="F">♀ Feminino</option>
                    </select>
                    {friendDone && (
                      <div style={{ background: C.grn + '15', border: `1px solid ${C.grn}33`, borderRadius: 10, padding: '10px 14px', color: C.grn, fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
                        ✅ Amigo adicionado!
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={addFriend} disabled={!friendForm.name.trim() || friendSending}
                        style={{ flex: 1, background: C.grn, border: 'none', borderRadius: 10, padding: '12px', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {friendSending ? '...' : '✅ Confirmar amigo'}
                      </button>
                      <button onClick={() => setShowFriendForm(false)}
                        style={{ background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 16px', color: C.mut, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                Limite de convidados atingido.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
