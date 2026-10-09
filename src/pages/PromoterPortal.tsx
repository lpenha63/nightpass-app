import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabasePublico } from '../lib/supabase'
import { InstallButton } from '../components/InstallButton'
import QRCode from 'react-qr-code'

const C = {
  bg: '#0a0e1a', card: '#111827', brd: '#1e2736',
  acc: '#3b82f6', grn: '#10b981', red: '#f87171',
  gold: '#f59e0b', txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af',
  purp: '#7c3aed', purpL: '#a78bfa',
}

/** Numeros do painel (RPC promoter_painel). */
interface Painel {
  mes_cadastrados: number; mes_entraram: number
  total_cadastrados: number; total_entraram: number
  meta: number; comissao_pct: number; taxa_entrada_cents: number
  fixo_cents: number; consumacao_cents: number
  proximo_id: string | null; proximo_nome: string | null
  proximo_data: string | null; proximo_hora: string | null
  proximo_na_lista: number
  melhor_nome: string | null; melhor_entradas: number
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
  /** Teto de vagas definido pela casa. null/0 = sem limite. */
  max_guests?: number | null
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
  // Cliente com o token no cabeçalho: o RLS dessas tabelas deixou de ser aberto
  // e só devolve as linhas deste link.
  const supabase = useMemo(() => supabasePublico(token), [token])

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
  const [painel, setPainel] = useState<Painel | null>(null)
  const [qrDe, setQrDe] = useState<{ token: string; evento: string } | null>(null)

  // Manifest do app instalado: abre direto neste portal e leva a logo da casa.
  //
  // Antes era montado aqui e servido como `blob:`. A URL de blob muda a cada
  // carregamento, entao o navegador nao reconhecia o app instalado como o mesmo —
  // instalacao instavel e atalho duplicado. E o mesmo defeito ja corrigido na
  // agenda da equipe; agora o manifest tem URL fixa (/api/manifest).
  //
  // Roda em duas etapas de proposito: a primeira (sem a casa) entra assim que a
  // pagina abre, para o navegador nunca oferecer instalar com o manifest do painel
  // admin (start_url "/") caso a pessoa toque em instalar antes dos dados chegarem.
  useEffect(() => {
    const inicio = window.location.pathname
    const url = `/api/manifest?app=promoter&inicio=${encodeURIComponent(inicio)}`
      + (houseId ? `&casa=${encodeURIComponent(houseId)}` : '')
    let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null
    const anterior = link ? link.getAttribute('href') : null
    if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link) }
    link.setAttribute('href', url)
    return () => { if (anterior) link!.setAttribute('href', anterior) }
  }, [token, houseId])

  async function loadLists(pId: string, hId: string) {
    const { data } = await supabase
      .from('promoter_lists')
      .select('id, name, token, max_guests, event_id, house_id, promoter_id, events(promoter_enabled,promoter_invites)')
      .eq('promoter_id', pId)
      .eq('house_id', hId)

    if (!data) { setLists([]); return }

    // Mostra listas de eventos liberados a todos OU que convidaram este promoter
    type Joined = PromoterListItem & { events?: { promoter_enabled?: boolean; promoter_invites?: string[] } | Array<{ promoter_enabled?: boolean; promoter_invites?: string[] }> | null }
    const liberadas = (data as unknown as Joined[]).filter(l => {
      const e = Array.isArray(l.events) ? l.events[0] : l.events
      return e?.promoter_enabled === true || (Array.isArray(e?.promoter_invites) && e!.promoter_invites!.includes(pId))
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
      // 1. Promoter + casa a partir do token, numa RPC só.
      //    Antes isto lia promoter_tokens direto, e a tabela estava com SELECT aberto:
      //    dava para listar TODOS os tokens de portal e entrar no de qualquer promoter.
      // Numeros do painel. Vem de RPC propria porque o portal e anonimo: ele nao
      // pode ler checkins nem promoters direto.
      supabase.rpc('promoter_painel', { p_token: token })
        .then(r => setPainel(((r.data as Painel[] | null) ?? [])[0] ?? null))
      const { data: rpc } = await supabase.rpc('get_promoter_by_token', { p_token: token })
      const info = (rpc?.[0] ?? null) as {
        promoter_id: string; house_id: string
        full_name: string; photo_url?: string; phone?: string; status: string
        house_name?: string; house_logo?: string
      } | null

      if (!info) { setNotFound(true); setLoading(false); return }

      const pId = info.promoter_id
      const hId = info.house_id
      setPromoterId(pId)
      setHouseId(hId)
      setPromoter({ id: pId, full_name: info.full_name, photo_url: info.photo_url, phone: info.phone, status: info.status } as PromoterInfo)
      setHouse({ name: info.house_name ?? '', logo_url: info.house_logo })

      // 4. Eventos futuros liberados a TODOS (promoter_enabled) OU que convidaram este promoter
      const today = new Date().toISOString().slice(0, 10)
      const { data: evData } = await supabase
        .from('events')
        .select('id, name, event_date, start_time, flyer_url, status, genre, promoter_enabled, promoter_invites')
        .eq('house_id', hId)
        .neq('status', 'cancelado')
        .gte('event_date', today)
        .order('event_date', { ascending: true })

      const visibleEvents = (evData ?? []).filter((e: { promoter_enabled?: boolean; promoter_invites?: string[] }) =>
        e.promoter_enabled === true || (Array.isArray(e.promoter_invites) && e.promoter_invites.includes(pId)))
      setEvents(visibleEvents as EventItem[])

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

  /**
   * Imagem 9:16 do evento para o promoter postar no Stories.
   *
   * O flyer cru postado direto sai com tarja ou cortado — cartaz e 2:3, story e
   * 9:16. O endpoint devolve o flyer inteiro sobre o fundo desfocado.
   *
   * Tenta o compartilhamento nativo com arquivo: no celular isso abre o
   * Instagram direto, sem passar por download. Onde nao houver, abre numa aba
   * para a pessoa segurar e salvar.
   */
  async function compartilharStory(listToken: string, nomeEvento: string) {
    const url = `${window.location.origin}/api/preview-imagem?type=lista&token=${listToken}&formato=story`
    try {
      const r = await fetch(url)
      if (r.ok) {
        const arquivo = new File([await r.blob()], `${nomeEvento.replace(/[^\w\s-]/g, '').trim() || 'evento'}.jpg`, { type: 'image/jpeg' })
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
        if (nav.canShare?.({ files: [arquivo] })) {
          await navigator.share({ files: [arquivo] })
          return
        }
      }
    } catch { /* sem compartilhamento nativo: abre a imagem */ }
    window.open(url, '_blank')
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
            <img loading="lazy" decoding="async" src={house.logo_url} alt="logo"
              style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', marginBottom: 12 }} />
          )}
          <div style={{ color: C.purpL, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
            Portal do Promoter
          </div>

          {/* Promoter avatar */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            {promoter?.photo_url
              ? <img loading="lazy" decoding="async" src={promoter.photo_url} alt={promoter.full_name}
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

        {/* Painel. Os tres numeros antigos (total de convidados, eventos futuros,
            minhas listas) nao levavam a lugar nenhum. O que decide a vida do
            promoter e quantos dos cadastrados ENTRARAM — numero que so passou a
            existir com a atribuicao de check-in. */}
        {painel && (
          <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>

            {/* Proximo evento: e nele que ele precisa agir hoje */}
            {painel.proximo_nome && (
              <div style={{ background: `linear-gradient(135deg, ${C.purp}22, ${C.card})`, border: `1px solid ${C.purp}55`, borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ color: C.purpL, fontSize: 10, fontWeight: 800, letterSpacing: '.08em' }}>PRÓXIMO EVENTO</div>
                <div style={{ color: C.txt, fontWeight: 800, fontSize: 17, marginTop: 3 }}>{painel.proximo_nome}</div>
                <div style={{ color: C.sub, fontSize: 12.5, marginTop: 2 }}>
                  📅 {painel.proximo_data ? fdateShort(painel.proximo_data) : ''}
                  {painel.proximo_hora ? ` às ${painel.proximo_hora.slice(0, 5)}` : ''}
                  {' · '}
                  <b style={{ color: painel.proximo_na_lista > 0 ? C.purpL : C.gold }}>
                    {painel.proximo_na_lista > 0
                      ? `${painel.proximo_na_lista} na sua lista`
                      : 'ninguém na sua lista ainda'}
                  </b>
                </div>
              </div>
            )}

            {/* Mes corrente. A taxa e o que a casa olha para renovar com o promoter. */}
            {(() => {
              const cad = painel.mes_cadastrados, ent = painel.mes_entraram
              const taxa = cad > 0 ? Math.round((ent / cad) * 100) : null
              const cor = taxa == null ? C.mut : taxa >= 50 ? C.grn : taxa >= 25 ? C.gold : C.red
              return (
                <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: '12px 16px' }}>
                  <div style={{ color: C.mut, fontSize: 10, fontWeight: 800, letterSpacing: '.08em', marginBottom: 8 }}>ESTE MÊS</div>
                  <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
                    <div><div style={{ color: C.txt, fontWeight: 800, fontSize: 21 }}>{cad}</div>
                      <div style={{ color: C.mut, fontSize: 11 }}>cadastrou</div></div>
                    <div><div style={{ color: C.grn, fontWeight: 800, fontSize: 21 }}>{ent}</div>
                      <div style={{ color: C.mut, fontSize: 11 }}>entraram</div></div>
                    {taxa != null && (
                      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                        <div style={{ color: cor, fontWeight: 800, fontSize: 21 }}>{taxa}%</div>
                        <div style={{ color: C.mut, fontSize: 11 }}>compareceram</div>
                      </div>
                    )}
                  </div>

                  {/* Meta: so aparece se a casa cadastrou uma. */}
                  {painel.meta > 0 && (() => {
                    const pct = Math.min(100, Math.round((ent / painel.meta) * 100))
                    return (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: C.sub, marginBottom: 4 }}>
                          <span>Meta do mês: {painel.meta} entradas</span>
                          <span style={{ color: ent >= painel.meta ? C.grn : C.gold, fontWeight: 700 }}>
                            {ent >= painel.meta ? '✅ batida' : `faltam ${painel.meta - ent}`}
                          </span>
                        </div>
                        <div style={{ background: C.bg, borderRadius: 999, height: 7, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: ent >= painel.meta ? C.grn : C.purp, borderRadius: 999, transition: 'width .4s' }} />
                        </div>
                      </div>
                    )
                  })()}

                  {/* Ganho: so quando a casa configurou alguma remuneracao. */}
                  {(painel.taxa_entrada_cents > 0 || painel.fixo_cents > 0) && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}`, fontSize: 12.5, color: C.sub }}>
                      💰 <b style={{ color: C.grn }}>
                        {(((painel.fixo_cents + ent * painel.taxa_entrada_cents) / 100)
                          .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}
                      </b>{' '}
                      no mês
                      {painel.taxa_entrada_cents > 0 && (
                        <span style={{ color: C.mut }}>
                          {' '}· {(painel.taxa_entrada_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por entrada
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {painel.melhor_nome && painel.melhor_entradas > 0 && (
              <div style={{ color: C.mut, fontSize: 11.5, textAlign: 'center' }}>
                🏆 Seu melhor evento: <b style={{ color: C.sub }}>{painel.melhor_nome}</b> — {painel.melhor_entradas} entradas
              </div>
            )}
          </div>
        )}

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

            {shownEvents.map((event, i) => {
              const list = lists.find(l => l.event_id === event.id)
              const isCreating = creatingFor === event.id
              const isViewingGuests = viewingList === event.id

              // Cabecalho de mes. A lista vinha corrida: em novembro cheio, o
              // promoter rolava sem saber onde um mes acaba e o outro comeca.
              // Os eventos ja chegam ordenados por data, entao basta comparar
              // com o anterior.
              const mes = event.event_date.slice(0, 7)
              const abreMes = i === 0 || shownEvents[i - 1].event_date.slice(0, 7) !== mes
              const nomeMes = new Date(event.event_date + 'T12:00')
                .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
              const quantos = shownEvents.filter(e => e.event_date.slice(0, 7) === mes).length

              return (
                <Fragment key={event.id}>
                {abreMes && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    margin: i === 0 ? '4px 0 12px' : '24px 0 12px',
                  }}>
                    <span style={{ color: C.purpL, fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' }}>
                      {nomeMes}
                    </span>
                    <span style={{ color: C.mut, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {quantos} evento{quantos !== 1 ? 's' : ''}
                    </span>
                    <div style={{ flex: 1, height: 1, background: C.brd }} />
                  </div>
                )}
                <div style={{
                  background: C.card,
                  border: `1px solid ${list ? '#7c3aed44' : C.brd}`,
                  borderRadius: 16,
                  marginBottom: 16,
                  overflow: 'hidden',
                }}>
                  {/* Flyer */}
                  {event.flyer_url ? (
                    <div style={{ position: 'relative', height: 160, overflow: 'hidden' }}>
                      <img loading="lazy" decoding="async" src={event.flyer_url} alt={event.name}
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
{(() => {
                          const usados = list.guest_count ?? 0
                          const teto = list.max_guests ?? 0
                          const cheia = teto > 0 && usados >= teto
                          const pct = teto > 0 ? Math.min(100, Math.round((usados / teto) * 100)) : 0
                          return (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: cheia ? C.gold : C.purpL, fontWeight: 800, fontSize: 18 }}>{usados}</span>
                                {teto > 0
                                  ? <span style={{ color: C.mut, fontSize: 12 }}>de {teto} vagas</span>
                                  : <span style={{ color: C.mut, fontSize: 12 }}>convidado{usados !== 1 ? 's' : ''}</span>}
                                {cheia && <span style={{ marginLeft: 'auto', color: C.gold, fontSize: 11, fontWeight: 800 }}>LOTADA</span>}
                              </div>
                              {/* Barra so quando ha teto: sem limite, uma barra sempre vazia
                                  nao diz nada e ainda sugere que falta gente. */}
                              {teto > 0 && (
                                <div style={{ background: C.bg, borderRadius: 999, height: 6, overflow: 'hidden', marginTop: 6 }}>
                                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, transition: 'width .4s',
                                    background: cheia ? C.gold : pct >= 80 ? C.gold : C.purp }} />
                                </div>
                              )}
                            </div>
                          )
                        })()}
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
                          <button onClick={() => setQrDe({ token: list.token, evento: event.name })}
                            title="QR da lista"
                            style={{
                              background: 'transparent', border: `1px solid ${C.brd}`,
                              borderRadius: 10, padding: '8px 12px', color: C.mut,
                              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                            }}>
                            ▣
                          </button>
                          <button onClick={() => compartilharStory(list.token, event.name)}
                            title="Imagem para o Stories"
                            style={{
                              background: 'transparent', border: `1px solid ${C.brd}`,
                              borderRadius: 10, padding: '8px 12px', color: C.mut,
                              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                            }}>
                            📸
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
                          <GuestList list={list} supabase={supabase} onAdded={() => setLists(ls => ls.map(x => x.id === list.id ? { ...x, guest_count: (x.guest_count ?? 0) + 1 } : x))} />
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
                </Fragment>
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

        {/* QR da lista: serve para o promoter que esta no balcao ou na rua — a
            pessoa aponta a camera e se cadastra sozinha, sem pedir o numero
            dela nem mandar link. */}
        {qrDe && (
          <div onClick={() => setQrDe(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 18, padding: '22px 22px 18px', maxWidth: 340, width: '100%', textAlign: 'center' }}>
              <div style={{ color: '#111', fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{qrDe.evento}</div>
              <div style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>Aponte a câmera para entrar na lista</div>
              {/* Fundo branco fixo, nao do tema: QR em fundo escuro muitos leitores nao leem. */}
              <div style={{ background: '#fff', padding: 8, display: 'inline-block' }}>
                <QRCode value={getListUrl(qrDe.token)} size={232} />
              </div>
              <button onClick={() => setQrDe(null)}
                style={{ marginTop: 18, width: '100%', background: C.purp, border: 'none', borderRadius: 10, padding: '11px 0', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Recebe o cliente do portal por prop: ele carrega o token no cabeçalho, sem o qual
// o RLS não devolve convidado nenhum.
type SB = ReturnType<typeof supabasePublico>
function GuestList({ list, onAdded, supabase }: { list: PromoterListItem; onAdded?: () => void; supabase: SB }) {
  const [guests, setGuests] = useState<{ id: string; full_name: string; phone?: string; gender?: string; checked_in?: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('promoter_list_guests')
      .select('id, full_name, phone, gender, checked_in')
      .eq('list_id', list.id)
      // Ordenava por created_at, coluna que não existe nesta tabela: a consulta
      // devolvia erro e a lista aparecia sempre vazia.
      .order('full_name', { ascending: true })
      .then(r => { setGuests(r.data ?? []); setLoading(false) })
  }, [list.id])

  async function addGuest() {
    const nm = name.trim()
    if (!nm) { setErr('Informe o nome do convidado.'); return }
    setSaving(true); setErr(null)
    const { data, error } = await supabase.from('promoter_list_guests').insert({
      house_id: list.house_id, list_id: list.id, promoter_id: list.promoter_id, event_id: list.event_id,
      full_name: nm, phone: phone.trim() || null, gender: gender || null, list_type: 'promoter',
    }).select('id, full_name, phone, gender').single()
    setSaving(false)
    // 23514 (check_violation) vem do gatilho de limite de vagas, e a mensagem
    // dele ja esta escrita para o convidado ler.
    if (error) { setErr(error.code === '23514' ? error.message : 'Erro ao adicionar: ' + error.message); return }
    if (data) {
      setGuests(gs => [...gs, data])
      setName(''); setPhone(''); setGender('')
      onAdded?.()
    }
  }

  const fieldStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8,
    padding: '9px 11px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
  }

  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.brd}`, paddingTop: 12 }}>
      {/* Formulário de adição manual */}
      <div style={{ background: C.bg, border: `1px solid ${C.purp}44`, borderRadius: 10, padding: 10, marginBottom: 12 }}>
        <div style={{ color: C.purpL, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>➕ Adicionar convidado</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome do convidado *"
            onKeyDown={e => { if (e.key === 'Enter') addGuest() }} style={fieldStyle} />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Celular (opcional)" inputMode="tel"
            onKeyDown={e => { if (e.key === 'Enter') addGuest() }} style={fieldStyle} />
          <div style={{ display: 'flex', gap: 6 }}>
            {([['M', '♂ Masc.', C.acc], ['F', '♀ Fem.', '#f472b6']] as const).map(([g, lbl, col]) => {
              const on = gender === g
              return (
                <button key={g} type="button" onClick={() => setGender(on ? '' : g)}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${on ? col : C.brd}`, background: on ? col + '22' : 'transparent', color: on ? col : C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {lbl}
                </button>
              )
            })}
          </div>
          {err && <div style={{ color: C.red, fontSize: 11 }}>{err}</div>}
          <button onClick={addGuest} disabled={saving}
            style={{ width: '100%', background: saving ? C.purp + '55' : `linear-gradient(135deg, ${C.purp}, #1d4ed8)`, border: 'none', borderRadius: 8, padding: '10px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Adicionando...' : '✅ Adicionar à lista'}
          </button>
        </div>
      </div>

      {/* Lista de convidados */}
      {loading ? (
        <div style={{ color: C.mut, fontSize: 12 }}>Carregando...</div>
      ) : guests.length === 0 ? (
        <div style={{ color: C.mut, fontSize: 12 }}>Nenhum convidado ainda</div>
      ) : (
        guests.map((g, i) => (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.txt, fontSize: 13, padding: '6px 0', borderBottom: i < guests.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
            {/* Quem ja entrou fica verde. O dado existe desde que o check-in passou
                a marcar o convidado — antes a lista nao sabia quem veio. */}
            <span title={g.checked_in ? 'Já entrou' : 'Ainda não entrou'}
              style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: g.checked_in ? C.grn : C.brd }} />
            <span style={{ flex: 1, color: g.checked_in ? C.grn : C.txt }}>
              {i + 1}. {(g.gender === 'F' || g.gender === 'feminino') ? '♀ ' : (g.gender === 'M' || g.gender === 'masculino') ? '♂ ' : ''}{g.full_name}
              {g.phone ? <span style={{ color: C.mut, fontSize: 12 }}> · {g.phone}</span> : ''}
            </span>
            {/* Cutucar: so para quem tem telefone e ainda nao entrou. Abre o
                WhatsApp do proprio promoter — nao depende da API da casa. */}
            {!g.checked_in && g.phone && (
              <a href={`https://wa.me/55${g.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Oi ${g.full_name.split(' ')[0]}! Você está na lista — é só chegar e falar seu nome na portaria. Te espero! 🎉`)}`}
                target="_blank" rel="noopener noreferrer" title="Lembrar pelo WhatsApp"
                style={{ flexShrink: 0, textDecoration: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '3px 8px', fontSize: 12 }}>
                💬
              </a>
            )}
          </div>
        ))
      )}
    </div>
  )
}
