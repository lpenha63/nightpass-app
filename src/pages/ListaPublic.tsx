import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#0a0e1a', card: '#111827', brd: '#1e2736',
  acc: '#3b82f6', grn: '#10b981', red: '#f87171',
  gold: '#f59e0b', txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af',
}

interface PromoterList {
  id: string
  name: string
  house_id: string
  event_id: string
  promoter_id: string
  promoters?: { full_name: string; photo_url?: string }
  events?: { name: string; event_date: string; start_time?: string; flyer_url?: string }
  houses?: { name: string; logo_url?: string }
}

interface Guest { name: string; phone: string; cpf: string; gender: string; birth_date: string }
interface SavedGuest { id: string; full_name: string; phone?: string; cpf?: string; gender?: string }

const EMPTY: Guest = { name: '', phone: '', cpf: '', gender: '', birth_date: '' }

function fmtCPF(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
         .replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')
         .replace(/(\d{3})(\d{3})/, '$1.$2')
}
function fmtPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (d.length >= 10)  return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return d
}

const INP: React.CSSProperties = {
  width: '100%', background: '#1f2937', border: `1px solid ${C.brd}`,
  borderRadius: 10, padding: '12px 14px', color: C.txt, fontSize: 15,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

export function ListaPublicPage({ token }: { token: string }) {
  const [lista, setLista] = useState<PromoterList | null>(null)
  const [saved, setSaved] = useState<SavedGuest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)

  // Read URL params for pre-filling (when sent via personalized link)
  const params = new URLSearchParams(window.location.search)
  const preNome = params.get('nome') ?? ''
  const preTel  = params.get('tel')  ?? ''

  const [form, setForm] = useState<Guest>({ ...EMPTY, name: preNome, phone: preTel })

  useEffect(() => {
    supabase.from('promoter_lists')
      .select('*,promoters(full_name,photo_url),events(name,event_date,start_time,flyer_url),houses(name,logo_url)')
      .eq('token', token).single()
      .then(r => {
        if (r.error || !r.data) { setNotFound(true); setLoading(false); return }
        setLista(r.data as PromoterList)
        supabase.from('promoter_list_guests').select('*').eq('list_id', r.data.id)
          .then(g => { setSaved((g.data ?? []) as SavedGuest[]); setLoading(false) })
      })
  }, [token])

  async function addGuest() {
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    if (!lista) return
    setSubmitting(true); setError('')
    const { data, error: err } = await supabase.from('promoter_list_guests').insert({
      list_id: lista.id,
      house_id: lista.house_id,
      event_id: lista.event_id,
      promoter_id: lista.promoter_id,
      full_name: form.name.trim(),
      phone: form.phone.replace(/\D/g, '') || null,
      cpf: form.cpf.replace(/\D/g, '') || null,
      gender: form.gender || null,
      birth_date: form.birth_date || null,
      promoter_confirmed: true,
    }).select().single()
    if (err) { setError('Erro ao salvar. Tente novamente.'); setSubmitting(false); return }
    setSaved(p => [...p, data as SavedGuest])
    setForm(EMPTY)
    setSubmitting(false)
    setDone(true)
  }

  async function removeGuest(id: string) {
    await supabase.from('promoter_list_guests').delete().eq('id', id)
    setSaved(p => p.filter(g => g.id !== id))
  }

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
        <div style={{ color: C.txt, fontWeight: 700, fontSize: 18 }}>Lista não encontrada</div>
        <div style={{ color: C.mut, fontSize: 14, marginTop: 8 }}>Verifique o link com seu promoter</div>
      </div>
    </div>
  )

  if (done) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
        <div style={{ color: C.grn, fontWeight: 900, fontSize: 22, marginBottom: 8 }}>Você está na lista!</div>
        <div style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>
          Presença confirmada em <strong style={{ color: C.acc }}>{lista?.events?.name}</strong>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 16, textAlign: 'left', marginBottom: 16 }}>
          {saved.map((g, i) => (
            <div key={g.id} style={{ padding: '8px 0', borderBottom: i < saved.length - 1 ? `1px solid ${C.brd}` : 'none', color: C.txt, fontSize: 14 }}>
              {g.gender === 'feminino' ? '♀' : g.gender === 'masculino' ? '♂' : '👤'} {g.full_name}
              {g.phone ? <span style={{ color: C.mut, fontSize: 12 }}> · {fmtPhone(g.phone)}</span> : ''}
            </div>
          ))}
        </div>
        <div style={{ background: C.gold + '15', border: `1px solid ${C.gold}33`, borderRadius: 12, padding: '12px 16px', color: C.gold, fontSize: 13, fontWeight: 600 }}>
          📍 Apresente este link ou seu nome na portaria em {lista?.events?.name}
        </div>
        <button onClick={() => setDone(false)}
          style={{ marginTop: 16, background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 20px', color: C.mut, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          Adicionar mais pessoas
        </button>
      </div>
    </div>
  )

  const ev = lista!.events

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{
        background: ev?.flyer_url
          ? `linear-gradient(to bottom, rgba(10,14,26,0.4) 0%, rgba(10,14,26,1) 100%), url(${ev.flyer_url}) center/cover`
          : `linear-gradient(135deg,#7c3aed,#1d4ed8,#0a0e1a)`,
        padding: '40px 20px 28px', textAlign: 'center',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {lista!.houses?.logo_url && (
            <img src={lista!.houses.logo_url} alt="logo" style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', marginBottom: 10 }} />
          )}
          <div style={{ color: '#a78bfa', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
            Lista da Casa
          </div>
          <h1 style={{ color: C.txt, fontSize: 22, fontWeight: 900, margin: '0 0 6px' }}>
            {ev?.name ?? lista!.name}
          </h1>
          {ev && (
            <div style={{ color: C.sub, fontSize: 13 }}>
              📅 {fdate(ev.event_date)}{ev.start_time ? ` · 🕙 ${ev.start_time.slice(0, 5)}` : ''}
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* Saved guests counter */}
        {saved.length > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: '14px 18px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: C.txt, fontWeight: 800, fontSize: 20 }}>{saved.length}</div>
              <div style={{ color: C.mut, fontSize: 12 }}>já na lista</div>
            </div>
            <div style={{ color: '#a78bfa', fontSize: 28 }}>🎭</div>
          </div>
        )}

        {/* Add form */}
        {preNome && (
          <div style={{ background: '#10b98111', border: '1px solid #10b98133', borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: '#10b981', fontSize: 13, fontWeight: 600 }}>
            ✅ Confirme seus dados abaixo para entrar na lista
          </div>
        )}
        <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, marginBottom: 10, letterSpacing: '0.06em' }}>
          {preNome ? 'CONFIRMAR PRESENÇA' : 'ADICIONAR À LISTA'}
        </div>

        <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>NOME COMPLETO *</label>
            <input style={INP} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addGuest()}
              placeholder="Nome completo" autoFocus={!preNome} />
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>GÊNERO</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['masculino', 'feminino'].map(g => (
                  <button key={g} onClick={() => setForm(p => ({ ...p, gender: p.gender === g ? '' : g }))}
                    style={{ flex: 1, padding: 10, borderRadius: 10, border: `2px solid ${form.gender === g ? '#7c3aed' : C.brd}`, background: form.gender === g ? 'rgba(124,58,237,0.2)' : 'transparent', color: form.gender === g ? '#a78bfa' : C.mut, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {g === 'masculino' ? '♂' : '♀'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5 }}>NASCIMENTO</label>
              <input style={{ ...INP, color: form.birth_date ? C.txt : C.mut }} type="date"
                value={form.birth_date}
                onChange={e => setForm(p => ({ ...p, birth_date: e.target.value }))} />
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: C.red + '22', border: `1px solid ${C.red}44`, borderRadius: 10, padding: '10px 14px', color: C.red, fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <button onClick={addGuest} disabled={submitting}
          style={{ width: '100%', background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontSize: 16, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, fontFamily: 'inherit' }}>
          {submitting ? 'Salvando...' : preNome ? '✅ Confirmar Presença' : '➕ Entrar na Lista'}
        </button>

        {saved.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, marginBottom: 10, letterSpacing: '0.06em' }}>JÁ NA LISTA</div>
            {saved.map((g, i) => (
              <div key={g.id} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>
                    {i + 1}.{' '}
                    {g.gender === 'feminino' ? <span style={{ color: '#f472b6' }}>♀ </span> : g.gender === 'masculino' ? <span style={{ color: C.acc }}>♂ </span> : ''}
                    {g.full_name}
                  </div>
                  {g.phone && <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>📱 {fmtPhone(g.phone)}</div>}
                </div>
                <button onClick={() => removeGuest(g.id)}
                  style={{ background: 'none', border: 'none', color: C.mut, fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', marginTop: 20 }}>
          Você pode retornar a este link para adicionar ou remover convidados
        </div>
      </div>
    </div>
  )
}
