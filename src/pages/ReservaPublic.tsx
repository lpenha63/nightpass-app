import { useState, useEffect, useMemo } from 'react'
import { supabasePublico } from '../lib/supabase'

const C = {
  bg: '#0a0e1a', card: '#111827', brd: '#1e2736',
  acc: '#3b82f6', grn: '#10b981', red: '#f87171',
  gold: '#f59e0b', txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af',
}

interface Reservation {
  id: string
  name: string
  phone?: string
  people_count: number
  location?: string
  expected_arrival?: string
  reservation_date?: string
  house_id: string
  event_id?: string
  reservation_type?: string
  flyer_url?: string
  events?: { name: string; event_date: string }
  houses?: { name: string; logo_url?: string }
}

const VALUE_TYPES = [
  { value: 'normal', label: '🎫 Pagamento Normal' },
  { value: 'antecipado', label: '⚡ Pagamento Antecipado' },
  { value: 'desconto', label: '🏷️ Com Desconto' },
  { value: 'vip', label: '👑 VIP' },
  { value: 'cortesia', label: '🎁 Cortesia' },
]

interface Guest { name: string; phone: string; cpf: string; gender: string; value_type: string }
interface SavedGuest { id: string; name: string; phone?: string; cpf?: string; gender?: string; value_type?: string }

const EMPTY_GUEST: Guest = { name: '', phone: '', cpf: '', gender: '', value_type: '' }

function fmtCPF(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
         .replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')
         .replace(/(\d{3})(\d{3})/, '$1.$2')
}

function fmtPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (d.length >= 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return d
}

const INP: React.CSSProperties = {
  width: '100%', background: '#1f2937', border: `1px solid ${C.brd}`,
  borderRadius: 10, padding: '12px 14px', color: C.txt, fontSize: 15,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

export function ReservaPublicPage({ token }: { token: string }) {
  const [reserva, setReserva] = useState<Reservation | null>(null)
  const [saved, setSaved] = useState<SavedGuest[]>([])
  const [form, setForm] = useState<Guest>(EMPTY_GUEST)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  // Cliente que envia o token no cabeçalho: o RLS só libera os convidados desta reserva
  const sb = useMemo(() => supabasePublico(token), [token])

  useEffect(() => {
    sb.from('reservations')
      .select('*,events(name,event_date),houses(name,logo_url)')
      .eq('token', token).single()
      .then(r => {
        if (r.error || !r.data) { setNotFound(true); setLoading(false); return }
        setReserva(r.data as Reservation)
        // Load existing guests
        sb.from('reservation_guests').select('*').eq('reservation_id', r.data.id)
          .then(g => { setSaved((g.data ?? []) as SavedGuest[]); setLoading(false) })
      })
  }, [token, sb])

  async function addGuest() {
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    if (!reserva) return
    if (saved.length >= reserva.people_count) { setError(`Limite de ${reserva.people_count} convidado(s) atingido`); return }
    setSubmitting(true); setError('')
    const { data, error: err } = await sb.from('reservation_guests').insert({
      reservation_id: reserva.id,
      house_id: reserva.house_id,
      event_id: reserva.event_id ?? null,
      name: form.name.trim(),
      phone: form.phone.replace(/\D/g, '') || null,
      cpf: form.cpf.replace(/\D/g, '') || null,
      gender: form.gender || null,
      value_type: form.value_type || null,
    }).select().single()
    if (err) { setError('Erro ao salvar. Tente novamente.'); setSubmitting(false); return }
    setSaved(p => [...p, data as SavedGuest])
    setForm(EMPTY_GUEST)
    setSubmitting(false)
  }

  async function removeGuest(id: string) {
    await sb.from('reservation_guests').delete().eq('id', id)
    setSaved(p => p.filter(g => g.id !== id))
  }

  function finish() { setDone(true) }

  function fdate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.mut }}>Carregando...</div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
        <div style={{ color: C.txt, fontWeight: 700, fontSize: 18 }}>Reserva não encontrada</div>
        <div style={{ color: C.mut, fontSize: 14, marginTop: 8 }}>Verifique o link recebido</div>
      </div>
    </div>
  )

  if (done) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <div style={{ color: C.grn, fontWeight: 900, fontSize: 22, marginBottom: 8 }}>Tudo certo!</div>
        <div style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>
          {saved.length} convidado{saved.length !== 1 ? 's' : ''} cadastrado{saved.length !== 1 ? 's' : ''} para a reserva de <strong style={{ color: C.txt }}>{reserva?.name}</strong>.
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 16, textAlign: 'left' }}>
          {saved.map((g, i) => (
            <div key={g.id} style={{ padding: '8px 0', borderBottom: i < saved.length - 1 ? `1px solid ${C.brd}` : 'none', color: C.txt, fontSize: 14 }}>
              👤 {g.name}{g.phone ? ` · ${fmtPhone(g.phone)}` : ''}
            </div>
          ))}
        </div>
        <div style={{ color: C.mut, fontSize: 12, marginTop: 16 }}>
          Apresente este link na portaria ou aguarde o staff verificar seu nome na lista.
        </div>
      </div>
    </div>
  )

  const spotsLeft = reserva!.people_count - saved.length
  const ev = reserva!.events

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Inter', sans-serif" }}>
      {/* Flyer */}
      {reserva!.flyer_url && (
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 20px 0' }}>
          <div style={{ position: 'relative', paddingBottom: '100%', borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.brd}` }}>
            <img loading="lazy" decoding="async" src={reserva!.flyer_url} alt="flyer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }} />
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: reserva!.flyer_url ? 'transparent' : `linear-gradient(135deg,#1d4ed8,#0a0e1a)`, padding: '28px 20px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {!reserva!.flyer_url && reserva!.houses?.logo_url && (
            <img loading="lazy" decoding="async" src={reserva!.houses.logo_url} alt="logo" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', marginBottom: 12 }} />
          )}
          <div style={{ color: C.acc, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            {reserva!.houses?.name ?? ''}
          </div>
          <h1 style={{ color: C.txt, fontSize: 24, fontWeight: 900, margin: '0 0 6px' }}>
            🪑 Reserva: {reserva!.name}
          </h1>
          {ev && (
            <div style={{ color: C.sub, fontSize: 14 }}>
              🎉 {ev.name} · {fdate(ev.event_date)}
            </div>
          )}
          {reserva!.location && (
            <div style={{ color: C.gold, fontSize: 13, marginTop: 6, fontWeight: 600 }}>
              📍 {reserva!.location}
            </div>
          )}
          {reserva!.expected_arrival && (
            <div style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>
              🕐 Chegada prevista: {reserva!.expected_arrival}
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* Progress */}
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: '14px 18px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: C.txt, fontWeight: 800, fontSize: 18 }}>{saved.length} / {reserva!.people_count}</div>
            <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>convidados cadastrados</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {spotsLeft > 0
              ? <div style={{ color: C.grn, fontWeight: 700, fontSize: 14 }}>✅ {spotsLeft} vaga{spotsLeft !== 1 ? 's' : ''} restante{spotsLeft !== 1 ? 's' : ''}</div>
              : <div style={{ color: C.gold, fontWeight: 700, fontSize: 14 }}>🔒 Lista completa</div>
            }
          </div>
        </div>

        {/* Guest list */}
        {saved.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ color: C.sub, fontSize: 12, fontWeight: 700, marginBottom: 10, letterSpacing: '0.06em' }}>CONVIDADOS CADASTRADOS</div>
            {saved.map((g, i) => (
              <div key={g.id} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>
                    {i + 1}. {g.name}
                    {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 12, marginLeft: 6 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
                  </div>
                  <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                    {g.phone ? `📱 ${fmtPhone(g.phone)}` : ''}{g.phone && g.cpf ? '  ·  ' : ''}{g.cpf ? `📄 ${fmtCPF(g.cpf)}` : ''}
                    {g.value_type && (
                      <span style={{ marginLeft: g.phone || g.cpf ? 8 : 0, background: C.acc + '22', color: C.acc, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
                        {VALUE_TYPES.find(vt => vt.value === g.value_type)?.label ?? g.value_type}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => removeGuest(g.id)}
                  style={{ background: 'none', border: 'none', color: C.mut, fontSize: 18, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add guest form */}
        {spotsLeft > 0 ? (
          <>
            <div style={{ color: C.sub, fontSize: 12, fontWeight: 700, marginBottom: 10, letterSpacing: '0.06em' }}>
              ADICIONAR CONVIDADO {saved.length + 1}/{reserva!.people_count}
            </div>
            <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>NOME COMPLETO *</label>
                <input style={INP} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Nome completo do convidado" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>CELULAR</label>
                  <input style={INP} type="tel" value={fmtPhone(form.phone)}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                    placeholder="(11) 99999-9999" />
                </div>
                <div>
                  <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>CPF</label>
                  <input style={INP} value={fmtCPF(form.cpf)}
                    onChange={e => setForm(p => ({ ...p, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                    placeholder="000.000.000-00" />
                </div>
              </div>
              <div>
                <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>GÊNERO</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['masculino', 'feminino'].map(g => (
                    <button key={g} onClick={() => setForm(p => ({ ...p, gender: p.gender === g ? '' : g }))}
                      style={{ flex: 1, padding: '10px', borderRadius: 10, border: `2px solid ${form.gender === g ? C.acc : C.brd}`, background: form.gender === g ? C.acc + '22' : 'transparent', color: form.gender === g ? C.acc : C.mut, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {g === 'masculino' ? '♂ Masculino' : '♀ Feminino'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>TIPO DE INGRESSO</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {VALUE_TYPES.map(vt => (
                    <button key={vt.value} onClick={() => setForm(p => ({ ...p, value_type: p.value_type === vt.value ? '' : vt.value }))}
                      style={{ padding: '8px 12px', borderRadius: 10, border: `2px solid ${form.value_type === vt.value ? C.acc : C.brd}`, background: form.value_type === vt.value ? C.acc + '22' : 'transparent', color: form.value_type === vt.value ? C.acc : C.mut, fontSize: 13, fontWeight: form.value_type === vt.value ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {vt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div style={{ background: C.red + '22', border: `1px solid ${C.red}44`, borderRadius: 10, padding: '10px 14px', color: C.red, fontSize: 13, marginBottom: 14 }}>
                {error}
              </div>
            )}

            <button onClick={addGuest} disabled={submitting}
              style={{ width: '100%', background: `linear-gradient(135deg,#1d4ed8,${C.acc})`, color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontSize: 16, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, fontFamily: 'inherit', marginBottom: 12 }}>
              {submitting ? 'Salvando...' : '➕ Adicionar Convidado'}
            </button>
          </>
        ) : null}

        {/* Finish button */}
        {saved.length > 0 && (
          <button onClick={finish}
            style={{ width: '100%', background: C.grn + '22', border: `1px solid ${C.grn}44`, color: C.grn, borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
            ✅ Finalizar lista ({saved.length} convidado{saved.length !== 1 ? 's' : ''})
          </button>
        )}

        <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', marginTop: 20 }}>
          Você pode retornar a este link para editar até o momento da chegada
        </div>
      </div>
    </div>
  )
}
