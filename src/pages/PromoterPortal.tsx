import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { InstallButton } from '../components/InstallButton'

const C = {
  bg: '#0a0e1a', card: '#111827', brd: '#1e2736',
  acc: '#3b82f6', grn: '#10b981', red: '#f87171',
  gold: '#f59e0b', txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af',
  purp: '#7c3aed', purpL: '#a78bfa',
}

interface PromoterInfo {
  id: string
  full_name: string
  photo_url?: string
  phone?: string
  status: string
}

interface EventItem {
  id: string
  name: string
  event_date: string
  start_time?: string
  flyer_url?: string
  status: string
  genre?: string
}

interface PromoterListItem {
  id: string
  name: string
  token: string
  event_id: string
  house_id: string
  promoter_id: string
  guest_count?: number
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

export function PromoterPortal({ token }: { token: string }) {
  const [promoter, setPromoter] = useState<PromoterInfo | null>(null)
  const [events, setEvents] = useState<EventItem[]>([])
  const [lists, setLists] = useState<PromoterListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [house, setHouse] = useState<{ name: string; logo_url?: string } | null>(null)
  const [houseId, setHouseId] = useState<string | null>(null)
  const [promoterId, setPromoterId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [viewingList, setViewingList] = useState<string | null>(null)
  const [genreFilter, setGenreFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all')

  // Manifest dinâmico: o app instalado abre direto neste portal do promoter
  useEffect(() => {
    const manifest = {
      name: 'Portal do Promoter',
      short_name: 'Promoter',
      start_url: window.location.pathname,
      scope: window.location.pathname,
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#0a0e1a',
      theme_color: '#7c3aed',
      lang: 'pt-BR',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
    const url = URL.createObjectURL(blob)
    let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null
    const prev = link ? link.getAttribute('href') : null
    if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link) }
    link.setAttribute('href', url)
    return () => { URL.revokeObjectURL(url); if (prev) link!.setAttribute('href', prev) }
  }, [token])

  async function loadLists(pId: string, hId: string) {
    const { data } = await supabase
      .from('promoter_lists')
      .select('id, name, token, event_id, house_id, promoter_id, events(promoter_enabled)')
      .eq('promoter_id', pId)
      .eq('house_id', hId)

    if (!data) { setLists([]); return }

    // Não mostra listas de eventos que não estão (ou deixaram de estar) liberados para promoter
    type Joined = PromoterListItem & { events?: { promoter_enabled?: boolean } | Array<{ promoter_enabled?: boolean }> | null }
    const liberadas = (data as unknown as Joined[]).filter(l => {
      const e = Array.isArray(l.events) ? l.events[0] : l.events
      return e?.promoter_enabled === true
    })

    const withCounts = await Promise.all(
      liberadas.map(async (l) => {
        const { count } = await supabase
          .from('promoter_list_guests')
          .select('id', { count: 'exact', head: true })
          .eq('list_id', l.id)
        return { ...l, guest_count: count ?? 0 }
      })
    )
    setLists(withCounts as PromoterListItem[])
  }

  useEffect(() => {
    async function load() {
      // 1. Find promoter by token
      const { data: tokenData, error: tokenErr } = await supabase
        .from('promoter_tokens')
        .select('promoter_id, house_id, active')
        .eq('token', token)
        .single()

      if (tokenErr || !tokenData || !tokenData.active) {
        setNotFound(true); setLoading(false); return
      }

      const pId: string = tokenData.promoter_id
      const hId: string = tokenData.house_id
      setPromoterId(pId)
      setHouseId(hId)

      // 2. Load promoter info
      const { data: pData } = await supabase
        .from('promoters')
        .select('id, full_name, photo_url, phone, status')
        .eq('id', pId)
        .single()

      if (!pData || pData.status === 'inactive') {
        setNotFound(true); setLoading(false); return
      }
      setPromoter(pData as PromoterInfo)

      // 3. Load house info
      const { data: hData } = await supabase
        .from('houses')
        .select('name, logo_url')
        .eq('id', hId)
        .single()
      if (hData) setHouse(hData)

      // 4. Load upcoming events LIBERADOS para promoter (promoter_enabled = true)
      const today = new Date().toISOString().slice(0, 10)
      const { data: evData } = await supabase
        .from('events')
        .select('id, name, event_date, start_time, flyer_url, status, genre')
        .eq('house_id', hId)
        .eq('promoter_enabled', true)
        .neq('status', 'cancelado')
        .gte('event_date', today)
        .order('event_date', { ascending: true })

      setEvents((evData ?? []) as EventItem[])

      // 5. Load existing promoter lists
      await loadLists(pId, hId)

      setLoading(false)
    }
    load()
  }, [token])

  async function createList(event: EventItem) {
    if (!promoter || !houseId || !promoterId) return
    setCreatingFor(event.id)
    const newToken = crypto.randomUUID()
    const { error } = await supabase
      .from('promoter_lists')
      .insert({
        promoter_id: promoterId,
        house_id: houseId,
        event_id: event.id,
        name: `Lista de ${promoter.full_name}`,
        token: newToken,
      })

    if (error) {
      setCreatingFor(null)
      return
    }

    await loadLists(promoterId, houseId)
    setCreatingFor(null)
    setSuccessMsg(`Lista criada para ${event.name}!`)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  function getListUrl(listToken: string) {
    return `${window.location.origin}/lista/${listToken}`
  }

  function shareWhatsApp(list: PromoterListItem, event: EventItem) {
    const url = getListUrl(list.token)
    const evDate = fdateShort(event.event_date)
    const evTime = event.start_time ? event.start_time.slice(0, 5) : ''
    const houseName = house?.name ?? ''

    const msg = `🎭 *${event.name}*\n` +
      `📅 ${evDate}${evTime ? ` às ${evTime}` : ''}\n` +
      (houseName ? `📍 ${houseName}\n` : '') +
      `\nOlá! Você está na minha lista VIP 🌟\n\n` +
      `Preencha seus dados pelo link abaixo para garantir sua entrada:\n` +
      `👉 ${url}\n\n` +
      `_Apresente seu nome na portaria. Entrada garantida!_ ✅`

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function copyLink(listToken: string) {
    try {
      await navigator.clipboard.writeText(getListUrl(listToken))
      setCopied(listToken)
      setTimeout(() => setCopied(null), 2000)
    } catch {}
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.mut, fontSize: 14 }}>Carregando...</div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
        <div style={{ color: C.txt, fontWeight: 700, fontSize: 18 }}>Portal não encontrado</div>
        <div style={{ color: C.mut, fontSize: 14, marginTop: 8 }}>Link inválido ou promoter inativo</div>
      </div>
    </div>
  )

  const totalGuests = lists.reduce((a, l) => a + (l.guest_count ?? 0), 0)

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${C.purp}, #1d4ed8, #0a0e1a)`,
        padding: '40px 20px 32px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {house?.logo_url && (
            <img src={house.logo_url} alt="logo"
              style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', marginBottom: 12 }} />
          )}
          <div style={{ color: C.purpL, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
            Portal do Promoter
          </div>

          {/* Promoter avatar */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            {promoter?.photo_url
              ? <img src={promoter.photo_url} alt={promoter.full_name}
                  style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${C.purpL}` }} />
              : <div style={{ width: 72, height: 72, borderRadius: '50%', background: C.purp, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, border: `3px solid ${C.purpL}` }}>👤</div>
            }
          </div>

          <h1 style={{ color: C.txt, fontSize: 22, fontWeight: 900, margin: '0 0 4px' }}>
            {promoter?.full_name}
          </h1>
          <div style={{ color: C.purpL, fontSize: 13 }}>
            {house?.name}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* Stats bar */}
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: '14px 20px', marginBottom: 24, display: 'flex', gap: 24, justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: C.txt, fontWeight: 800, fontSize: 22 }}>{totalGuests}</div>
            <div style={{ color: C.mut, fontSize: 11 }}>convidados total</div>
          </div>
          <div style={{ width: 1, background: C.brd }} />
          <button onClick={() => setViewMode('all')}
            style={{ textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, borderRadius: 8, opacity: viewMode === 'all' ? 1 : 0.55 }}>
            <div style={{ color: viewMode === 'all' ? C.purpL : C.txt, fontWeight: 800, fontSize: 22 }}>{events.length}</div>
            <div style={{ color: C.mut, fontSize: 11 }}>eventos futuros</div>
          </button>
          <div style={{ width: 1, background: C.brd }} />
          <button onClick={() => setViewMode('mine')}
            style={{ textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, borderRadius: 8, opacity: viewMode === 'mine' ? 1 : 0.55 }}>
            <div style={{ color: viewMode === 'mine' ? C.purpL : C.txt, fontWeight: 800, fontSize: 22 }}>{lists.length}</div>
            <div style={{ color: viewMode === 'mine' ? C.purpL : C.mut, fontSize: 11, fontWeight: viewMode === 'mine' ? 700 : 400 }}>minhas listas</div>
          </button>
        </div>

        {/* Instalar como app */}
        <div style={{ marginBottom: 20 }}>
          <InstallButton full />
        </div>

        {/* Success message */}
        {successMsg && (
          <div style={{ background: C.grn + '22', border: `1px solid ${C.grn}44`, borderRadius: 12, padding: '12px 16px', color: C.grn, fontSize: 13, fontWeight: 700, marginBottom: 16, textAlign: 'center' }}>
            ✅ {successMsg}
          </div>
        )}

        {/* Events list */}
        {events.length > 0 && (() => {
          const genres = Array.from(new Set(events.map(e => (e.genre ?? '').trim()).filter(Boolean)))
          const base = viewMode === 'mine' ? events.filter(e => lists.some(l => l.event_id === e.id)) : events
          const shownEvents = genreFilter === 'all' ? base : base.filter(e => (e.genre ?? '').trim() === genreFilter)
          return (
          <>
            <div style={{ color: viewMode === 'mine' ? C.purpL : C.grn, fontSize: 11, fontWeight: 700, marginBottom: 12, letterSpacing: '0.06em' }}>
              {viewMode === 'mine' ? '📋 MINHAS LISTAS' : '🔥 PRÓXIMOS EVENTOS'}
            </div>

            {/* Filtro por tipo (gênero musical) — chips tocáveis (funcionam no app instalado) */}
            {genres.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
                {(['all', ...genres] as string[]).map(g => {
                  const active = genreFilter === g
                  return (
                    <button key={g} type="button" onClick={() => setGenreFilter(g)}
                      style={{
                        flexShrink: 0, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                        background: active ? C.purp : C.card,
                        border: `1px solid ${active ? C.purp : C.brd}`,
                        color: active ? '#fff' : C.sub,
                      }}>
                      {g === 'all' ? '🎫 Todos' : `🎵 ${g}`}
                    </button>
                  )
                })}
              </div>
            )}

            {shownEvents.length === 0 && (
              <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                {viewMode === 'mine' ? 'Você ainda não tem listas. Toque em "eventos futuros" e crie a sua.' : 'Nenhum evento deste tipo.'}
              </div>
            )}

            {shownEvents.map(event => {
              const list = lists.find(l => l.event_id === event.id)
              const isCreating = creatingFor === event.id
              const isViewingGuests = viewingList === event.id

              return (
                <div key={event.id} style={{
                  background: C.card,
                  border: `1px solid ${list ? '#7c3aed44' : C.brd}`,
                  borderRadius: 16,
                  marginBottom: 16,
                  overflow: 'hidden',
                }}>
                  {/* Flyer */}
                  {event.flyer_url ? (
                    <div style={{ position: 'relative', height: 160, overflow: 'hidden' }}>
                      <img src={event.flyer_url} alt={event.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(to bottom, transparent 30%, rgba(10,14,26,0.95) 100%)',
                      }} />
                      <div style={{ position: 'absolute', bottom: 12, left: 16, right: 16 }}>
                        <div style={{ color: C.txt, fontWeight: 900, fontSize: 16 }}>{event.name}</div>
                        <div style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>
                          📅 {fdate(event.event_date)}{event.start_time ? ` · 🕙 ${event.start_time.slice(0, 5)}` : ''}
                        </div>
                      </div>
                      <div style={{
                        position: 'absolute', top: 10, right: 10,
                        background: list ? C.purp : '#374151',
                        borderRadius: 20, padding: '3px 10px',
                        color: '#fff', fontSize: 10, fontWeight: 700,
                      }}>{list ? 'COM LISTA' : 'SEM LISTA'}</div>
                    </div>
                  ) : (
                    <div style={{ padding: '16px 16px 0' }}>
                      <div style={{ color: C.txt, fontWeight: 800, fontSize: 16 }}>{event.name}</div>
                      <div style={{ color: C.sub, fontSize: 13, marginTop: 4 }}>
                        📅 {fdate(event.event_date)}{event.start_time ? ` · 🕙 ${event.start_time.slice(0, 5)}` : ''}
                      </div>
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ padding: '12px 16px 16px' }}>
                    {list ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span style={{ color: C.purpL, fontWeight: 800, fontSize: 18 }}>{list.guest_count ?? 0}</span>
                          <span style={{ color: C.mut, fontSize: 12 }}>convidado{list.guest_count !== 1 ? 's' : ''}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => copyLink(list.token)}
                            style={{
                              background: copied === list.token ? C.grn + '22' : 'transparent',
                              border: `1px solid ${copied === list.token ? C.grn : C.brd}`,
                              borderRadius: 10, padding: '8px 12px',
                              color: copied === list.token ? C.grn : C.mut,
                              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                            }}>
                            {copied === list.token ? '✅' : '🔗'}
                          </button>
                          <button onClick={() => shareWhatsApp(list, event)}
                            style={{
                              flex: 1,
                              background: 'linear-gradient(135deg, #25D366, #128C7E)',
                              border: 'none', borderRadius: 10, padding: '8px 16px',
                              color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}>
                            <span style={{ fontSize: 16 }}>📲</span> Compartilhar
                          </button>
                          <button
                            onClick={() => setViewingList(isViewingGuests ? null : event.id)}
                            style={{
                              background: isViewingGuests ? C.purp + '33' : 'transparent',
                              border: `1px solid ${isViewingGuests ? C.purp : C.brd}`,
                              borderRadius: 10, padding: '8px 12px',
                              color: isViewingGuests ? C.purpL : C.mut,
                              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                            }}>
                            👥 Ver lista
                          </button>
                        </div>
                        {isViewingGuests && (
                          <GuestList listId={list.id} />
                        )}
                      </>
                    ) : (
                      <button
                        onClick={() => createList(event)}
                        disabled={isCreating}
                        style={{
                          width: '100%',
                          background: isCreating ? C.purp + '44' : `linear-gradient(135deg, ${C.purp}, #1d4ed8)`,
                          border: 'none', borderRadius: 10, padding: '10px 16px',
                          color: '#fff', fontSize: 14, fontWeight: 700,
                          cursor: isCreating ? 'not-allowed' : 'pointer',
                          fontFamily: 'inherit', opacity: isCreating ? 0.7 : 1,
                        }}>
                        {isCreating ? 'Criando...' : '➕ Criar minha lista'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </>
          )
        })()}

        {events.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎭</div>
            <div style={{ color: C.mut, fontSize: 14 }}>Nenhum evento disponível no momento</div>
          </div>
        )}

        <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', marginTop: 32 }}>
          Compartilhe os links diretamente pelo WhatsApp com seus convidados
        </div>
      </div>
    </div>
  )
}

function GuestList({ listId }: { listId: string }) {
  const [guests, setGuests] = useState<{ id: string; full_name: string; phone?: string; gender?: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('promoter_list_guests')
      .select('id, full_name, phone, gender')
      .eq('list_id', listId)
      .order('created_at', { ascending: true })
      .then(r => { setGuests(r.data ?? []); setLoading(false) })
  }, [listId])

  if (loading) return <div style={{ color: C.mut, fontSize: 12, marginTop: 10 }}>Carregando...</div>
  if (guests.length === 0) return <div style={{ color: C.mut, fontSize: 12, marginTop: 10 }}>Nenhum convidado ainda</div>

  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.brd}`, paddingTop: 12 }}>
      {guests.map((g, i) => (
        <div key={g.id} style={{ color: C.txt, fontSize: 13, padding: '4px 0', borderBottom: i < guests.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
          {i + 1}. {g.gender === 'feminino' ? '♀ ' : g.gender === 'masculino' ? '♂ ' : ''}{g.full_name}
          {g.phone ? <span style={{ color: C.mut, fontSize: 12 }}> · {g.phone}</span> : ''}
        </div>
      ))}
    </div>
  )
}
