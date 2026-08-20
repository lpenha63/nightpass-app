import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Btn, Modal } from '../components/ui'
import { fd, ftel, cn } from '../utils/format'
import { _err, type ToastState } from '../utils/toast'
import type { House, Client, BirthdayList, Event } from '../types'

interface Props { house: House }

interface ClientWithDays extends Client { daysUntil: number }

interface BirthdayListWithEvent extends BirthdayList {
  event_id?: string
  events?: {
    id: string
    name: string
    event_date: string
    start_time?: string
    flyer_url?: string
  }
}

export function AniversariosPage({ house }: Props) {
  const [clients, setClients] = useState<ClientWithDays[]>([])
  const [days, setDays] = useState('30')
  const [bdLists, setBdLists] = useState<BirthdayListWithEvent[]>([])
  const [bdModal, setBdModal] = useState(false)
  const [bdForm, setBdForm] = useState({ birthday_person_name: '', birthday_date: '', phone: '', status: 'pendente', event_id: '' })
  const [bdEditing, setBdEditing] = useState<string | null>(null)
  const [ldg, setLdg] = useState(true)
  const [toast, _setToast] = useState<ToastState | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  function load() {
    if (!house) return
    supabase.from('birthday_lists').select('*, events(id, name, event_date, start_time, flyer_url)').eq('house_id', house.id).order('birthday_date')
      .then(r => { setLdg(false); setBdLists((r.data ?? []) as unknown as BirthdayListWithEvent[]) })

    supabase.from('events').select('id, name, event_date, status').eq('house_id', house.id)
      .neq('status', 'cancelado').order('event_date', { ascending: false })
      .then(r => { setEvents((r.data ?? []) as Event[]) })

    supabase.from('clients').select('*').eq('house_id', house.id).not('birth_date', 'is', null)
      .then(r => {
        const now = new Date()
        const d = parseInt(days)
        const list = (r.data ?? []).map(c => {
          const bd = new Date((c.birth_date ?? '') + 'T00:00:00')
          let ty = new Date(now.getFullYear(), bd.getMonth(), bd.getDate())
          if (ty < now) ty = new Date(now.getFullYear() + 1, bd.getMonth(), bd.getDate())
          const diff = Math.ceil((ty.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          return { ...c, daysUntil: diff }
        }).filter(c => c.daysUntil <= d).sort((a, b) => a.daysUntil - b.daysUntil)
        setClients(list)
      })
  }

  useEffect(() => { load() }, [house.id, days])

  function saveBd() {
    if (!bdForm.birthday_person_name || !bdForm.birthday_date) return
    const data = { birthday_person_name: bdForm.birthday_person_name, birthday_date: bdForm.birthday_date, phone: bdForm.phone || null, status: bdForm.status, house_id: house.id, event_id: bdForm.event_id || null }
    const q = bdEditing ? supabase.from('birthday_lists').update(data).eq('id', bdEditing) : supabase.from('birthday_lists').insert(data)
    q.then(r => {
      if (r.error) { _err(r.error.message); return }
      setBdModal(false); setBdEditing(null); setBdForm({ birthday_person_name: '', birthday_date: '', phone: '', status: 'pendente', event_id: '' }); load()
    })
  }

  function delBd(id: string) {
    if (!confirm('Remover lista de aniversário?')) return
    supabase.from('birthday_lists').delete().eq('id', id).then(() => load())
  }

  function sendBdLista(bl: BirthdayListWithEvent) {
    const tk = bl.token
    const doSend = (token: string) => {
      const ph = cn(bl.phone ?? '')
      const url = `${window.location.origin}/niver/${token}`
      const ev = bl.events
      const evDateStr = ev?.event_date
        ? new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
        : ''
      const evTime = ev?.start_time ? ev.start_time.slice(0, 5) : ''
      const lines = [
        `🎂 Olá, ${bl.birthday_person_name.split(' ')[0]}!`,
        ``,
        `Sua lista de aniversário está pronta! 🎉`,
        ev ? `🎉 *${ev.name}*` : '',
        evDateStr ? `📅 *${evDateStr}${evTime ? ` às ${evTime}` : ''}*` : '',
        ``,
        `👇 Acesse o link para gerenciar sua lista de convidados:`,
        url,
        ev?.flyer_url ? `\n🖼️ Flyer do evento:\n${ev.flyer_url}` : '',
        ``,
        `_Informe seu nome ou apresente este link na portaria. Entrada garantida!_ ✅`,
      ].filter(l => l !== '').join('\n')
      window.open(`https://wa.me/${ph ? '55' + ph : ''}?text=${encodeURIComponent(lines)}`, '_blank')
    }
    if (tk) { doSend(tk); return }
    const newTk = crypto.randomUUID()
    supabase.from('birthday_lists').update({ token: newTk }).eq('id', bl.id).then(r => {
      if (r.error) { _err(r.error.message); return }
      doSend(newTk); load()
    })
  }

  async function copyBdLink(bl: BirthdayListWithEvent) {
    const getUrl = (token: string) => `${window.location.origin}/niver/${token}`
    const doCopy = async (token: string) => {
      try {
        await navigator.clipboard.writeText(getUrl(token))
        setCopiedToken(token)
        setTimeout(() => setCopiedToken(null), 2000)
      } catch {}
    }
    if (bl.token) { doCopy(bl.token); return }
    const newTk = crypto.randomUUID()
    supabase.from('birthday_lists').update({ token: newTk }).eq('id', bl.id).then(r => {
      if (r.error) { _err(r.error.message); return }
      doCopy(newTk); load()
    })
  }

  function openBdPortal(bl: BirthdayListWithEvent) {
    const doOpen = (token: string) => {
      window.open(`${window.location.origin}/niver/${token}`, '_blank')
    }
    if (bl.token) { doOpen(bl.token); return }
    const newTk = crypto.randomUUID()
    supabase.from('birthday_lists').update({ token: newTk }).eq('id', bl.id).then(r => {
      if (r.error) { _err(r.error.message); return }
      doOpen(newTk); load()
    })
  }

  function sendClientBdLista(c: ClientWithDays) {
    const ph = cn(c.phone ?? '')
    const msg = `🎂 Feliz Aniversário, ${c.full_name.split(' ')[0]}! Que seu dia seja incrível! 🎉`
    window.open(`https://wa.me/${ph ? '55' + ph : ''}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const dayLabel = (d: number) => d === 0 ? '🎂 Hoje!' : d === 1 ? '🎈 Amanhã!' : `Em ${d} dias`
  const dayColor = (d: number) => d === 0 ? C.red : d <= 3 ? C.gold : C.mut

  if (ldg) return <div style={{ padding: 60, textAlign: 'center', color: C.mut }}>Carregando...</div>

  return (
    <div style={{ paddingBottom: 80 }}>
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: C.grn + '22', border: `1px solid ${C.grn}44`, color: C.grn, borderRadius: 12, padding: '12px 18px', fontSize: 13, fontWeight: 700, zIndex: 1100 }}>{toast.msg}</div>}

      <Modal open={bdModal} title={bdEditing ? 'Editar Lista' : 'Nova Lista de Aniversário'} onClose={() => { setBdModal(false); setBdEditing(null) }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {(['birthday_person_name', 'birthday_date', 'phone'] as const).map(field => (
            <div key={field}>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                {field === 'birthday_person_name' ? 'Nome do Aniversariante *' : field === 'birthday_date' ? 'Data do Aniversário' : 'WhatsApp'}
              </label>
              <input
                type={field === 'birthday_date' ? 'date' : 'text'}
                value={bdForm[field]}
                onChange={e => setBdForm(p => ({ ...p, [field]: e.target.value }))}
                style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }}
              />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Evento</label>
            <select
              value={bdForm.event_id}
              onChange={e => setBdForm(p => ({ ...p, event_id: e.target.value }))}
              style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }}
            >
              <option value="">Sem evento vinculado</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.name} — {fd(ev.event_date)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={saveBd} style={{ flex: 1 }}>💾 Salvar</Btn>
            <Btn onClick={() => setBdModal(false)} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, marginBottom: 4 }}>🎂 Aniversários</h1>
          <p style={{ color: C.mut, fontSize: 14 }}>{clients.length} aniversariantes nos próximos {days} dias</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={days} onChange={e => setDays(e.target.value)}
            style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px', color: C.txt, fontSize: 14, minHeight: 40, fontFamily: 'inherit' }}>
            {['7', '14', '30', '60', '90'].map(d => <option key={d} value={d}>{d} dias</option>)}
          </select>
          <Btn onClick={() => { setBdEditing(null); setBdForm({ birthday_person_name: '', birthday_date: '', phone: '', status: 'pendente', event_id: '' }); setBdModal(true) }} icon="➕">Nova Lista</Btn>
        </div>
      </div>

      {/* Birthday Lists */}
      {bdLists.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 12 }}>📋 Listas de Aniversário</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {bdLists.map(bl => (
              <Card key={bl.id} style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>🎂 {bl.birthday_person_name}</div>
                    {bl.birthday_date && <div style={{ color: C.mut, fontSize: 13, marginTop: 2 }}>{fd(bl.birthday_date)}{bl.phone ? ` · ${ftel(bl.phone)}` : ''}</div>}
                    {bl.events && (
                      <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4, background: C.gold + '18', border: `1px solid ${C.gold}33`, borderRadius: 6, padding: '2px 8px', fontSize: 11, color: C.gold, fontWeight: 600 }}>
                        🎉 {bl.events.name} · {fd(bl.events.event_date)}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Btn onClick={() => sendBdLista(bl)} small variant="secondary">📲 WhatsApp</Btn>
                    <Btn onClick={() => copyBdLink(bl)} small variant="secondary">{copiedToken === bl.token ? '✅ Copiado' : '🔗 Copiar Link'}</Btn>
                    <Btn onClick={() => openBdPortal(bl)} small variant="secondary">🎂 Portal</Btn>
                    <Btn onClick={() => { setBdEditing(bl.id); setBdForm({ birthday_person_name: bl.birthday_person_name, birthday_date: bl.birthday_date ?? '', phone: bl.phone ?? '', status: 'pendente', event_id: (bl as any).event_id ?? '' }); setBdModal(true) }} small variant="ghost">✏️</Btn>
                    <Btn onClick={() => delBd(bl.id)} small variant="danger">🗑</Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming birthdays from clients */}
      <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 12 }}>👥 Aniversariantes do Período</div>
      {clients.length === 0
        ? <Card><div style={{ color: C.mut, textAlign: 'center', padding: 32 }}>Nenhum aniversariante nos próximos {days} dias</div></Card>
        : <div style={{ display: 'grid', gap: 10 }}>
          {clients.map(c => (
            <Card key={c.id} style={{ padding: '12px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 28, flexShrink: 0 }}>{c.daysUntil === 0 ? '🎂' : '🎈'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>{c.full_name}</div>
                  <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>{fd(c.birth_date ?? '')} · {c.phone ? ftel(c.phone) : 'Sem celular'}</div>
                </div>
                <span style={{ color: dayColor(c.daysUntil), fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{dayLabel(c.daysUntil)}</span>
                {c.phone && <Btn onClick={() => sendClientBdLista(c)} small variant="secondary">💬 WhatsApp</Btn>}
              </div>
            </Card>
          ))}
        </div>
      }

    </div>
  )
}
