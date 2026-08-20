import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession, guardarCasa } from './hooks/useSession'
import { UpdateBar } from './components/UpdateBar'
import { supabase } from './lib/supabase'
import { C, initTheme } from './constants/theme'
import { useTheme } from './hooks/useTheme'

// Aplica o tema salvo antes do primeiro render (evita flash)
initTheme()
import { Sidebar, type PageId } from './components/Sidebar'
import { BottomNav } from './components/BottomNav'
import { WhatsAppBar } from './components/WhatsAppBar'
import { useWhatsAppStatus } from './hooks/useWhatsAppStatus'
import { useSubscription } from './hooks/useSubscription'
import { SubscriptionGate } from './components/SubscriptionGate'
import { DashboardPage } from './pages/Dashboard'
import { CheckinPage } from './pages/Checkin'
import { ClientsPage } from './pages/Clients'
import { ReservasPage } from './pages/Reservas'
import { UsersPage } from './pages/Users'
import { WhatsAppPage } from './pages/WhatsApp'
import { ReportsPage } from './pages/Reports'
import { EventsPage } from './pages/Events'
import { PromotersPage } from './pages/Promoters'
import { FreelancersPage } from './pages/Freelancers'
import { AgendaPage } from './pages/Agenda'
import { EventPublicPage } from './pages/EventPublic'
import { TicketPublicPage } from './pages/TicketPublic'
import { PagamentoRetornoPage } from './pages/PagamentoRetorno'
import { SettingsPage } from './pages/Settings'
import { ReservaPublicPage } from './pages/ReservaPublic'
import { ListaPublicPage } from './pages/ListaPublic'
import { ConfirmarPresencaPage } from './pages/ConfirmarPresenca'
import { PromoterPortal } from './pages/PromoterPortal'
import { AniversariantePortal, NiverGuestPage } from './pages/AniversariantePortal'
import { LoginPage } from './pages/Login'

export default function App() {
  // Public event page: /e/[eventId]
  const publicMatch = window.location.pathname.match(/^\/e\/([a-f0-9-]{36})$/)
  if (publicMatch) return <EventPublicPage eventId={publicMatch[1]} />

  // Retorno do Checkout Pro: /pagamento/[order_id]
  const pagtoMatch = window.location.pathname.match(/^\/pagamento\/([a-f0-9-]{36})$/i)
  if (pagtoMatch) return <PagamentoRetornoPage orderId={pagtoMatch[1]} />

  // Ticket recovery page: /ingresso/[token]
  const ingressoMatch = window.location.pathname.match(/^\/ingresso\/([a-f0-9-]{36})$/i)
  if (ingressoMatch) return <TicketPublicPage token={ingressoMatch[1]} />

  // Public reservation page: /reserva/[token]
  const reservaMatch = window.location.pathname.match(/^\/reserva\/([a-zA-Z0-9_-]+)$/)
  if (reservaMatch) return <ReservaPublicPage token={reservaMatch[1]} />

  // Public promoter list page: /lista/[token]
  const listaMatch = window.location.pathname.match(/^\/lista\/([a-zA-Z0-9_-]+)$/)
  if (listaMatch) return <ListaPublicPage token={listaMatch[1]} />

  // Guest confirmation page: /confirmar/[token]
  const confirmarMatch = window.location.pathname.match(/^\/confirmar\/([a-zA-Z0-9_-]+)$/)
  if (confirmarMatch) return <ConfirmarPresencaPage token={confirmarMatch[1]} />

  // Promoter portal: /p/[token]
  const promoterMatch = window.location.pathname.match(/^\/p\/([a-zA-Z0-9_-]+)$/)
  if (promoterMatch) return <PromoterPortal token={promoterMatch[1]} />

  // Birthday list manager portal: /niver/[token]
  const niverMatch = window.location.pathname.match(/^\/niver\/([a-zA-Z0-9_-]+)$/)
  if (niverMatch) return <AniversariantePortal token={niverMatch[1]} />

  // Birthday guest registration: /niver-guest/[token]
  const niverGuestMatch = window.location.pathname.match(/^\/niver-guest\/([a-zA-Z0-9_-]+)$/)
  if (niverGuestMatch) return <NiverGuestPage token={niverGuestMatch[1]} />
  useTheme() // re-renderiza (estilos inline seguem o tema) ao trocar
  const { session, setSession, checked } = useSession()
  const [active, setActive] = useState<PageId>('dashboard')
  const pageHistoryRef = useRef<PageId[]>([])

  // Push a dummy history entry so popstate fires on back button
  useEffect(() => {
    window.history.pushState({ page: 'dashboard' }, '')
  }, [])

  // Intercept browser back button → navigate within app
  useEffect(() => {
    function onPopState() {
      const hist = pageHistoryRef.current
      if (hist.length > 0) {
        const prev = hist[hist.length - 1]
        pageHistoryRef.current = hist.slice(0, -1)
        setActive(prev)
        // Keep a dummy entry so next back press still fires popstate
        window.history.pushState({ page: prev }, '')
      } else {
        // No more internal history — push state back so app stays open
        window.history.pushState({ page: active }, '')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [active])

  // useCallback: referência estável → Sidebar/BottomNav (memoizados) não re-renderizam
  // a cada check-in em tempo real / poll do WhatsApp, só quando a navegação de fato muda.
  const navigateTo = useCallback((page: PageId) => {
    // Bloqueia navegação para páginas não liberadas (ex: colaborador só acessa a agenda)
    if (session && !session.allowedPages.includes(page)) {
      page = (session.allowedPages.find(p => !p.includes('.')) ?? 'dashboard') as PageId
    }
    if (page !== active) {
      pageHistoryRef.current = [...pageHistoryRef.current, active]
      window.history.pushState({ page }, '')
    }
    setActive(page)
  }, [session, active])

  // Redirect to the first allowed page if current page is not allowed (ex: colaborador → agenda)
  useEffect(() => {
    if (session && !session.allowedPages.includes(active)) {
      const first = (session.allowedPages.find(p => !p.includes('.')) ?? 'dashboard') as PageId
      navigateTo(first)
    }
  }, [session?.allowedPages])
  const [mOpen, setMOpen] = useState(false)
  const [newCI, setNewCI] = useState(0)
  const [reservaNav, setReservaNav] = useState<{ date: string; eventId?: string } | null>(null)
  const [pendingRatings, setPendingRatings] = useState(0)

  const refreshPending = useCallback(async () => {
    if (!session?.house) return
    const today = new Date().toISOString().slice(0, 10)
    const { data: evs } = await supabase.from('events').select('id').eq('house_id', session.house.id).lt('event_date', today)
    const ids = (evs ?? []).map(e => e.id)
    if (ids.length === 0) { setPendingRatings(0); return }
    const { data: efs } = await supabase.from('event_freelancers').select('event_id,freelancer_id').in('event_id', ids)
    const { data: rts } = await supabase.from('team_ratings').select('event_id,freelancer_id').in('event_id', ids)
    const ratedSet = new Set((rts ?? []).map(r => `${r.event_id}:${r.freelancer_id}`))
    const pendingEvents = new Set<string>()
    for (const ef of efs ?? []) {
      if (!ratedSet.has(`${ef.event_id}:${ef.freelancer_id}`)) pendingEvents.add(ef.event_id)
    }
    setPendingRatings(pendingEvents.size)
  }, [session?.house?.id])

  useEffect(() => { refreshPending() }, [refreshPending])

  useEffect(() => {
    if (!session?.house) return
    if (window.location.hostname === 'localhost') return // realtime só em produção (em dev não é necessário)
    const ch = supabase
      .channel(`app-ci-${session.house.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'checkins',
        filter: `house_id=eq.${session.house.id}`,
      }, () => setNewCI(n => n + 1))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [session?.house?.id])

  useEffect(() => {
    if (active === 'checkin') setNewCI(0)
  }, [active])

  // Fonte única de status do WhatsApp (compartilhada por barra do topo + sidebar)
  const wa = useWhatsAppStatus(session?.house?.id)

  // Assinatura SaaS da casa — controla bloqueio/banner de trial
  const { sub, loading: subLoading, refresh: refreshSub } = useSubscription(session?.house?.id)

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
  }, [setSession])

  const openWhatsApp = useCallback(() => navigateTo('whatsapp'), [navigateTo])

  if (!checked) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.mut, fontSize: 14 }}>Carregando...</div>
      </div>
    )
  }

  if (!session) {
    return <LoginPage onLogin={setSession} />
  }

  // Página efetiva: se a atual não é liberada, cai na primeira permitida (evita flash de página proibida)
  const safeActive: PageId = session.allowedPages.includes(active)
    ? active
    : ((session.allowedPages.find(p => !p.includes('.')) ?? 'dashboard') as PageId)

  // Cria APENAS o elemento da página ativa (antes o objeto recriava os 12 a cada render)
  // Troca de unidade: grava a preferência e recarrega. Dezenas de telas guardam dados
  // da casa em estado próprio (eventos, listas, caixa) — recarregar é a única forma
  // barata de garantir que nada da casa anterior sobre na tela.
  function trocarCasa(houseId: string) {
    guardarCasa(houseId)
    window.location.reload()
  }

  const sess = session
  function renderPage(id: PageId): React.ReactNode {
    switch (id) {
      case 'dashboard':   return <DashboardPage house={sess.house} user={sess.user} role={sess.role} houses={sess.houses} onTrocarCasa={trocarCasa} />
      case 'checkin':     return <CheckinPage house={sess.house} user={sess.user} role={sess.role} />
      case 'clients':     return <ClientsPage house={sess.house} user={sess.user} role={sess.role} />
      case 'events':      return <EventsPage house={sess.house} role={sess.role} allowedPages={sess.allowedPages} onGoToReservas={(date, eventId) => { setReservaNav({ date, eventId }); navigateTo('reservas') }} />
      case 'reservas':    return <ReservasPage house={sess.house} user={sess.user} initialNav={reservaNav} onNavConsumed={() => setReservaNav(null)} />
      case 'promoters':   return <PromotersPage house={sess.house} user={sess.user} />
      case 'reports':     return <ReportsPage house={sess.house} />
      case 'whatsapp':    return <WhatsAppPage house={sess.house} />
      case 'users':       return <UsersPage house={sess.house} user={sess.user} role={sess.role} />
      case 'freelancers': return <FreelancersPage house={sess.house} onRatingsChanged={refreshPending} />
      case 'settings':    return <SettingsPage house={sess.house} session={sess} sub={sub} refreshSub={refreshSub} />
      case 'agenda':      return <AgendaPage house={sess.house} user={sess.user} role={sess.role} />
      default:            return null
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg }}>
      <UpdateBar />
      <Sidebar
        session={session}
        active={safeActive}
        setActive={navigateTo}
        mOpen={mOpen}
        setMOpen={setMOpen}
        newCI={newCI}
        pendingRatings={pendingRatings}
        onLogout={handleLogout}
        waStatus={wa.status}
        onTrocarCasa={trocarCasa}
      />
      <main
        className="np-main page-anim"
        key={safeActive}
        style={{ marginLeft: 240, flex: 1, minHeight: '100vh', overflowY: 'auto', background: C.bg }}
      >
        <WhatsAppBar status={wa.status} reconnect={wa.reconnect} reconnecting={wa.reconnecting} onOpenSettings={openWhatsApp} />
        <div className="np-content" style={{ padding: '46px 32px 24px' }}>
          {/* Configurações fica sempre acessível (é onde se regulariza a assinatura) */}
          {safeActive === 'settings'
            ? renderPage(safeActive)
            : <SubscriptionGate session={session} sub={sub} loading={subLoading}>{renderPage(safeActive)}</SubscriptionGate>}
        </div>
      </main>
      <BottomNav
        active={safeActive}
        setActive={navigateTo}
        setMOpen={setMOpen}
        newCI={newCI}
        pendingRatings={pendingRatings}
      />
    </div>
  )
}
