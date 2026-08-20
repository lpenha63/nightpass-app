import { useState, useEffect, useMemo} from 'react'
import { supabasePublico } from '../lib/supabase'

const C = {
  bg: '#0a0e1a', card: '#111827', brd: '#1e2736',
  acc: '#3b82f6', grn: '#10b981', red: '#f87171',
  gold: '#f59e0b', txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af',
}

interface BirthdayList {
  id: string
  name: string
  token: string
  house_id: string
  event_id?: string
  phone?: string
  events?: {
    id: string
    name: string
    event_date: string
    start_time?: string
    flyer_url?: string
    description?: string
  }
  houses?: {
    name: string
    logo_url?: string
  }
}

interface Guest {
  id: string
  full_name: string
  phone?: string
  cpf?: string
  gender?: string
}

interface GuestForm {
  name: string
  phone: string
  cpf: string
  gender: string
}

const EMPTY_FORM: GuestForm = { name: '', phone: '', cpf: '', gender: '' }

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

function fdate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  })
}

function fdateShort(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit'
  })
}

const INP: React.CSSProperties = {
  width: '100%', background: '#1f2937', border: `1px solid ${C.brd}`,
  borderRadius: 10, padding: '12px 14px', color: C.txt, fontSize: 15,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

export function AniversariantePortal({ token }: { token: string }) {
  // Cliente com o token no cabeçalho: o RLS dessas tabelas deixou de ser aberto
  // e só devolve as linhas deste link.
  const supabase = useMemo(() => supabasePublico(token), [token])

  const [bdList, setBdList] = useState<BirthdayList | null>(null)
  const [guests, setGuests] = useState<Guest[]>([])
  const [form, setForm] = useState<GuestForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'share' | 'list'>('share')

  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase
        .from('birthday_lists')
        .select('*, events(id, name, event_date, start_time, flyer_url, description), houses(name, logo_url)')
        .eq('token', token)
        .single()

      if (err || !data) { setNotFound(true); setLoading(false); return }
      setBdList(data as BirthdayList)

      const { data: gData } = await supabase
        .from('birthday_list_guests')
        .select('*')
        .eq('list_id', data.id)
        .order('created_at', { ascending: true })

      setGuests((gData ?? []) as Guest[])
      setLoading(false)
    }
    load()
  }, [token])

  async function addGuest() {
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    if (!bdList) return
    setSubmitting(true); setError('')

    const { data, error: err } = await supabase
      .from('birthday_list_guests')
      .insert({
        list_id: bdList.id,
        house_id: bdList.house_id,
        event_id: bdList.event_id ?? null,
        full_name: form.name.trim(),
        phone: form.phone.replace(/\D/g, '') || null,
        cpf: form.cpf.replace(/\D/g, '') || null,
        gender: form.gender || null,
      })
      .select()
      .single()

    if (err) { setError('Erro ao salvar. Tente novamente.'); setSubmitting(false); return }
    setGuests(p => [...p, data as Guest])
    setForm(EMPTY_FORM)
    setSubmitting(false)
  }

  async function removeGuest(id: string) {
    await supabase.from('birthday_list_guests').delete().eq('id', id)
    setGuests(p => p.filter(g => g.id !== id))
  }

  function getPublicUrl() {
    return `${window.location.origin}/niver-guest/${token}`
  }

  function shareWhatsApp() {
    const url = getPublicUrl()
    const ev = bdList?.events
    const evName = ev?.name ?? 'meu aniversário'
    const evDate = ev?.event_date ? fdateShort(ev.event_date) : ''
    const evTime = ev?.start_time ? ev.start_time.slice(0, 5) : ''
    const houseName = bdList?.houses?.name ?? ''
    const bdName = bdList?.name ?? 'Aniversariante'

    const msg = `🎂 *Aniversário de ${bdName}*\n` +
      `🎉 *${evName}*\n` +
      (evDate ? `📅 ${evDate}${evTime ? ` às ${evTime}` : ''}\n` : '') +
      (houseName ? `📍 ${houseName}\n` : '') +
      `\nVocê está convidado(a)! 🥳\n\n` +
      `Confirme sua presença pelo link abaixo:\n` +
      `👉 ${url}\n\n` +
      `_Informe seu nome na portaria. Entrada garantida!_ ✅`

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(getPublicUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.mut }}>Carregando...</div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
        <div style={{ color: C.txt, fontWeight: 700, fontSize: 18 }}>Lista não encontrada</div>
        <div style={{ color: C.mut, fontSize: 14, marginTop: 8 }}>Verifique o link recebido</div>
      </div>
    </div>
  )

  if (done) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
        <div style={{ color: C.grn, fontWeight: 900, fontSize: 22, marginBottom: 8 }}>Lista enviada!</div>
        <div style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>
          {guests.length} convidado{guests.length !== 1 ? 's' : ''} na sua lista de aniversário
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 16, textAlign: 'left', marginBottom: 16 }}>
          {guests.map((g, i) => (
            <div key={g.id} style={{ padding: '8px 0', borderBottom: i < guests.length - 1 ? `1px solid ${C.brd}` : 'none', color: C.txt, fontSize: 14 }}>
              {g.gender === 'feminino' ? '♀ ' : g.gender === 'masculino' ? '♂ ' : '👤 '}
              {g.full_name}
              {g.phone ? <span style={{ color: C.mut, fontSize: 12 }}> · {fmtPhone(g.phone)}</span> : ''}
            </div>
          ))}
        </div>
        <div style={{ background: C.gold + '15', border: `1px solid ${C.gold}33`, borderRadius: 12, padding: '12px 16px', color: C.gold, fontSize: 13, fontWeight: 600 }}>
          📍 Apresente este link ou seu nome na portaria
        </div>
        <button onClick={() => setDone(false)}
          style={{ marginTop: 16, width: '100%', background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 12, padding: 12, color: C.mut, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
          ← Voltar para a lista
        </button>
      </div>
    </div>
  )

  const ev = bdList!.events

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{
        background: ev?.flyer_url
          ? `linear-gradient(to bottom, rgba(10,14,26,0.3) 0%, rgba(10,14,26,1) 100%), url(${ev.flyer_url}) center/cover`
          : `linear-gradient(135deg, #f59e0b44, #ec489944, #0a0e1a)`,
        padding: '40px 20px 28px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {bdList!.houses?.logo_url && (
            <img loading="lazy" decoding="async" src={bdList!.houses.logo_url} alt="logo"
              style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', marginBottom: 12 }} />
          )}

          <div style={{ fontSize: 48, marginBottom: 8 }}>🎂</div>

          <div style={{ color: C.gold, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
            Lista de Aniversário
          </div>

          <h1 style={{ color: C.txt, fontSize: 24, fontWeight: 900, margin: '0 0 6px' }}>
            {bdList!.name}
          </h1>

          {ev && (
            <div style={{ color: C.sub, fontSize: 13, marginBottom: 6 }}>
              🎉 {ev.name}
            </div>
          )}
          {ev && (
            <div style={{ color: C.sub, fontSize: 13 }}>
              📅 {fdate(ev.event_date)}{ev.start_time ? ` · 🕙 ${ev.start_time.slice(0, 5)}` : ''}
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['share', 'list'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '10px', borderRadius: 10,
                border: `1px solid ${tab === t ? C.gold : C.brd}`,
                background: tab === t ? C.gold + '22' : 'transparent',
                color: tab === t ? C.gold : C.mut,
                fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {t === 'share' ? '📲 Compartilhar' : `👥 Lista (${guests.length})`}
            </button>
          ))}
        </div>

        {/* Share tab */}
        {tab === 'share' && (
          <div>
            {/* Event card */}
            <div style={{ background: C.card, border: `1px solid ${C.gold}33`, borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
              {ev?.flyer_url && (
                <img loading="lazy" decoding="async" src={ev.flyer_url} alt={ev.name}
                  style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
              )}
              <div style={{ padding: 16 }}>
                <div style={{ color: C.txt, fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
                  {ev?.name ?? 'Evento'}
                </div>
                {ev && (
                  <div style={{ color: C.sub, fontSize: 13 }}>
                    📅 {fdate(ev.event_date)}{ev.start_time ? ` · 🕙 ${ev.start_time.slice(0, 5)}` : ''}
                  </div>
                )}
                {bdList!.houses?.name && (
                  <div style={{ color: C.mut, fontSize: 12, marginTop: 4 }}>
                    📍 {bdList!.houses.name}
                  </div>
                )}
              </div>
            </div>

            {/* Counter */}
            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: '14px 20px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: C.txt, fontWeight: 800, fontSize: 20 }}>{guests.length}</div>
                <div style={{ color: C.mut, fontSize: 12 }}>convidado{guests.length !== 1 ? 's' : ''} confirmado{guests.length !== 1 ? 's' : ''}</div>
              </div>
              <div style={{ fontSize: 28 }}>🎉</div>
            </div>

            {/* Share instructions */}
            <div style={{ background: '#1f2937', border: `1px solid ${C.brd}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                Como funciona?
              </div>
              <div style={{ color: C.sub, fontSize: 13, lineHeight: 1.6 }}>
                1. Clique em <strong style={{ color: '#25D366' }}>Compartilhar pelo WhatsApp</strong> para enviar o link para seus convidados<br />
                2. Cada convidado preenche o nome, telefone e CPF no link<br />
                3. Sua lista fica atualizada em tempo real aqui<br />
                4. Na portaria, informe seu nome e a lista é verificada automaticamente ✅
              </div>
            </div>

            {/* Link display */}
            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, color: C.sub, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getPublicUrl()}
              </div>
              <button onClick={copyLink}
                style={{ background: copied ? C.grn + '22' : 'transparent', border: `1px solid ${copied ? C.grn : C.brd}`, borderRadius: 8, padding: '6px 12px', color: copied ? C.grn : C.mut, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                {copied ? '✅ Copiado!' : '🔗 Copiar'}
              </button>
            </div>

            {/* WhatsApp button */}
            <button onClick={shareWhatsApp}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #25D366, #128C7E)',
                color: '#fff', border: 'none', borderRadius: 14,
                padding: 16, fontSize: 16, fontWeight: 800,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              <span style={{ fontSize: 20 }}>📲</span>
              Compartilhar pelo WhatsApp
            </button>
          </div>
        )}

        {/* List tab */}
        {tab === 'list' && (
          <div>
            {/* Guest list */}
            {guests.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, marginBottom: 10, letterSpacing: '0.06em' }}>
                  CONVIDADOS CONFIRMADOS
                </div>
                {guests.map((g, i) => (
                  <div key={g.id} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>
                        {i + 1}.{' '}
                        {g.gender === 'feminino' ? <span style={{ color: '#f472b6' }}>♀ </span> : g.gender === 'masculino' ? <span style={{ color: C.acc }}>♂ </span> : ''}
                        {g.full_name}
                      </div>
                      <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                        {g.phone ? `📱 ${fmtPhone(g.phone)}` : ''}
                        {g.phone && g.cpf ? '  ·  ' : ''}
                        {g.cpf ? `📄 ${fmtCPF(g.cpf)}` : ''}
                      </div>
                    </div>
                    <button onClick={() => removeGuest(g.id)}
                      style={{ background: 'none', border: 'none', color: C.mut, fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add guest form */}
            <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, marginBottom: 10, letterSpacing: '0.06em' }}>
              ADICIONAR CONVIDADO MANUALMENTE
            </div>

            <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>NOME COMPLETO *</label>
                <input style={INP} value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addGuest()}
                  placeholder="Nome completo do convidado" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>CELULAR</label>
                  <input style={INP} type="tel"
                    value={fmtPhone(form.phone)}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                    placeholder="(11) 99999-9999" />
                </div>
                <div>
                  <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>CPF</label>
                  <input style={INP}
                    value={fmtCPF(form.cpf)}
                    onChange={e => setForm(p => ({ ...p, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                    placeholder="000.000.000-00" />
                </div>
              </div>
              <div>
                <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>GÊNERO</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['masculino', 'feminino'].map(g => (
                    <button key={g} onClick={() => setForm(p => ({ ...p, gender: p.gender === g ? '' : g }))}
                      style={{ flex: 1, padding: 10, borderRadius: 10, border: `2px solid ${form.gender === g ? C.gold : C.brd}`, background: form.gender === g ? C.gold + '22' : 'transparent', color: form.gender === g ? C.gold : C.mut, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {g === 'masculino' ? '♂ Masculino' : '♀ Feminino'}
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
              style={{ width: '100%', background: `linear-gradient(135deg, ${C.gold}, #d97706)`, color: '#000', border: 'none', borderRadius: 14, padding: 16, fontSize: 16, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, fontFamily: 'inherit', marginBottom: 12 }}>
              {submitting ? 'Salvando...' : '➕ Adicionar à Lista'}
            </button>

            {guests.length > 0 && (
              <button onClick={() => setDone(true)}
                style={{ width: '100%', background: C.grn + '22', border: `1px solid ${C.grn}44`, color: C.grn, borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✅ Fechar lista ({guests.length} convidado{guests.length !== 1 ? 's' : ''})
              </button>
            )}
          </div>
        )}

        <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', marginTop: 24 }}>
          Você pode retornar a este link para gerenciar seus convidados
        </div>
      </div>
    </div>
  )
}

// Public guest registration page (convidado filling in own info)
interface GuestRegForm {
  name: string
  phone: string
  cpf: string
  gender: string
}

export function NiverGuestPage({ token }: { token: string }) {
  // Cliente com o token no cabeçalho: o RLS dessas tabelas deixou de ser aberto
  // e só devolve as linhas deste link.
  const supabase = useMemo(() => supabasePublico(token), [token])

  const [bdList, setBdList] = useState<BirthdayList | null>(null)
  const [guests, setGuests] = useState<Guest[]>([])
  const [form, setForm] = useState<GuestRegForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase
        .from('birthday_lists')
        .select('*, events(id, name, event_date, start_time, flyer_url), houses(name, logo_url)')
        .eq('token', token)
        .single()

      if (err || !data) { setNotFound(true); setLoading(false); return }
      setBdList(data as BirthdayList)

      const { data: gData } = await supabase
        .from('birthday_list_guests')
        .select('id, full_name, phone, gender')
        .eq('list_id', data.id)

      setGuests((gData ?? []) as Guest[])
      setLoading(false)
    }
    load()
  }, [token])

  async function register() {
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    if (!bdList) return
    setSubmitting(true); setError('')

    const { data, error: err } = await supabase
      .from('birthday_list_guests')
      .insert({
        list_id: bdList.id,
        house_id: bdList.house_id,
        event_id: bdList.event_id ?? null,
        full_name: form.name.trim(),
        phone: form.phone.replace(/\D/g, '') || null,
        cpf: form.cpf.replace(/\D/g, '') || null,
        gender: form.gender || null,
      })
      .select()
      .single()

    if (err) { setError('Erro ao salvar. Tente novamente.'); setSubmitting(false); return }
    setGuests(p => [...p, data as Guest])
    setForm(EMPTY_FORM)
    setDone(true)
    setSubmitting(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.mut }}>Carregando...</div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
        <div style={{ color: C.txt, fontWeight: 700, fontSize: 18 }}>Lista não encontrada</div>
        <div style={{ color: C.mut, fontSize: 14, marginTop: 8 }}>Verifique o link recebido</div>
      </div>
    </div>
  )

  if (done) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
        <div style={{ color: C.grn, fontWeight: 900, fontSize: 24, marginBottom: 8 }}>Presença confirmada!</div>
        <div style={{ color: C.sub, fontSize: 15, marginBottom: 20 }}>
          Você está na lista de aniversário de <strong style={{ color: C.gold }}>{bdList?.name}</strong>
        </div>
        {bdList?.events && (
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>{bdList.events.name}</div>
            <div style={{ color: C.sub, fontSize: 13, marginTop: 6 }}>
              📅 {fdate(bdList.events.event_date)}
              {bdList.events.start_time ? ` · 🕙 ${bdList.events.start_time.slice(0, 5)}` : ''}
            </div>
            {bdList.houses?.name && (
              <div style={{ color: C.mut, fontSize: 12, marginTop: 4 }}>📍 {bdList.houses.name}</div>
            )}
          </div>
        )}
        <div style={{ background: C.gold + '15', border: `1px solid ${C.gold}33`, borderRadius: 12, padding: '12px 16px', color: C.gold, fontSize: 13, fontWeight: 600 }}>
          📍 Apresente este link ou seu nome na portaria
        </div>
      </div>
    </div>
  )

  const ev = bdList!.events

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{
        background: ev?.flyer_url
          ? `linear-gradient(to bottom, rgba(10,14,26,0.3) 0%, rgba(10,14,26,1) 100%), url(${ev.flyer_url}) center/cover`
          : `linear-gradient(135deg, #f59e0b33, #ec489933, #0a0e1a)`,
        padding: '40px 20px 28px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {bdList!.houses?.logo_url && (
            <img loading="lazy" decoding="async" src={bdList!.houses.logo_url} alt="logo"
              style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', marginBottom: 12 }} />
          )}
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎂</div>
          <div style={{ color: C.gold, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
            Confirmação de Presença
          </div>
          <h1 style={{ color: C.txt, fontSize: 22, fontWeight: 900, margin: '0 0 6px' }}>
            Aniversário de {bdList!.name}
          </h1>
          {ev && (
            <div style={{ color: C.sub, fontSize: 13 }}>
              🎉 {ev.name} · 📅 {fdateShort(ev.event_date)}{ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : ''}
            </div>
          )}
          <div style={{ marginTop: 10, color: C.sub, fontSize: 12 }}>
            {guests.length} convidado{guests.length !== 1 ? 's' : ''} confirmado{guests.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, marginBottom: 10, letterSpacing: '0.06em' }}>
          CONFIRMAR MINHA PRESENÇA
        </div>

        <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>NOME COMPLETO *</label>
            <input style={INP} value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && register()}
              placeholder="Seu nome completo"
              autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>CELULAR</label>
              <input style={INP} type="tel"
                value={fmtPhone(form.phone)}
                onChange={e => setForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                placeholder="(11) 99999-9999" />
            </div>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>CPF</label>
              <input style={INP}
                value={fmtCPF(form.cpf)}
                onChange={e => setForm(p => ({ ...p, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                placeholder="000.000.000-00" />
            </div>
          </div>
          <div>
            <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>GÊNERO</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['masculino', 'feminino'].map(g => (
                <button key={g} onClick={() => setForm(p => ({ ...p, gender: p.gender === g ? '' : g }))}
                  style={{ flex: 1, padding: 10, borderRadius: 10, border: `2px solid ${form.gender === g ? C.gold : C.brd}`, background: form.gender === g ? C.gold + '22' : 'transparent', color: form.gender === g ? C.gold : C.mut, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {g === 'masculino' ? '♂ Masculino' : '♀ Feminino'}
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

        <button onClick={register} disabled={submitting}
          style={{ width: '100%', background: `linear-gradient(135deg, ${C.gold}, #d97706)`, color: '#000', border: 'none', borderRadius: 14, padding: 16, fontSize: 16, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, fontFamily: 'inherit' }}>
          {submitting ? 'Confirmando...' : '🎉 Confirmar Presença'}
        </button>

        <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', marginTop: 20 }}>
          Seus dados serão verificados na portaria no dia do evento
        </div>
      </div>
    </div>
  )
}
