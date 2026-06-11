import { useState, useEffect, useRef } from 'react'
import { useSession } from './hooks/useSession'
import { supabase } from './lib/supabase'
import { C } from './constants/theme'
import { Sidebar, type PageId } from './components/Sidebar'
import { BottomNav } from './components/BottomNav'
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
import { EventPublicPage } from './pages/EventPublic'
import { SettingsPage } from './pages/Settings'
import { ReservaPublicPage } from './pages/ReservaPublic'
import { ListaPublicPage } from './pages/ListaPublic'
import { PromoterPortal } from './pages/PromoterPortal'
import { AniversariantePortal, NiverGuestPage } from './pages/AniversariantePortal'
import { LoginPage } from './pages/Login'

export default function App() {
  // Public event page: /e/[eventId]
  const publicMatch = window.location.pathname.match(/^\/e\/([a-f0-9-]{36})$/)
  if (publicMatch) return <EventPublicPage eventId={publicMatch[1]} />

  // Public reservation page: /reserva/[token]
  const reservaMatch = window.location.pathname.match(/^\/reserva\/([a-zA-Z0-9_-]+)$/)
  if (reservaMatch) return <ReservaPublicPage token={reservaMatch[1]} />

  // Public promoter list page: /lista/[token]
  const listaMatch = window.location.pathname.match(/^\/lista\/([a-zA-Z0-9_-]+)$/)
  if (listaMatch) return <ListaPublicPage token={listaMatch[1]} />

  // Promoter portal: /p/[token]
  const promoterMatch = window.location.pathname.match(/^\/p\/([a-zA-Z0-9_-]+)$/)
  if (promoterMatch) return <PromoterPortal token={promoterMatch[1]} />

  // Birthday list manager portal: /niver/[token]
  const niverMatch = window.location.pathname.match(/^\/niver\/([a-zA-Z0-9_-]+)$/)
  if (niverMatch) return <AniversariantePortal token={niverMatch[1]} />

  // Birthday guest registration: /niver-guest/[token]
  const niverGuestMatch = window.location.pathname.match(/^\/niver-guest\/([a-zA-Z0-9_-]+)$/)
  if (niverGuestMatch) return <NiverGuestPage token={niverGuestMatch[1]} />
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

  function navigateTo(page: PageId) {
    if (page !== active) {
      pageHistoryRef.current = [...pageHistoryRef.current, active]
      window.history.pushState({ page }, '')
    }
    setActive(page)
  }

  // Redirect to dashboard if current page is not allowed
  useEffect(() => {
    if (session && !session.allowedPages.includes(active)) {
      navigateTo('dashboard')
    }
  }, [session?.allowedPages])
  const [mOpen, setMOpen] = useState(false)
  const [newCI, setNewCI] = useState(0)
  const [reservaNav, setReservaNav] = useState<{ date: string; eventId?: string } | null>(null)

  useEffect(() => {
    if (!session?.house) return
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

  async function handleLogout() {
    await supabase.auth.signOut()
    setSession(null)
  }

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

  const pages: Record<PageId, React.ReactNode> = {
    dashboard: <DashboardPage house={session.house} user={session.user} role={session.role} />,
    checkin:   <CheckinPage house={session.house} user={session.user} role={session.role} />,
    clients:   <ClientsPage house={session.house} user={session.user} role={session.role} />,
    events:    <EventsPage house={session.house} onGoToReservas={(date, eventId) => { setReservaNav({ date, eventId }); navigateTo('reservas') }} />,
    reservas:  <ReservasPage house={session.house} user={session.user} initialNav={reservaNav} onNavConsumed={() => setReservaNav(null)} />,
    promoters: <PromotersPage house={session.house} user={session.user} />,
    reports:   <ReportsPage house={session.house} />,
    whatsapp:  <WhatsAppPage house={session.house} />,
    users:       <UsersPage house={session.house} user={session.user} role={session.role} />,
    freelancers: <FreelancersPage house={session.house} />,
    settings:    <SettingsPage house={session.house} />,
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg }}>
      <Sidebar
        session={session}
        active={active}
        setActive={navigateTo}
        mOpen={mOpen}
        setMOpen={setMOpen}
        newCI={newCI}
        onLogout={handleLogout}
      />
      <main
        className="np-main page-anim"
        key={active}
        style={{ marginLeft: 240, flex: 1, minHeight: '100vh', overflowY: 'auto', background: C.bg }}
      >
        <div style={{ padding: '16px 32px' }}>
          {pages[active]}
        </div>
      </main>
      <BottomNav
        active={active}
        setActive={navigateTo}
        setMOpen={setMOpen}
        newCI={newCI}
      />
    </div>
  )
}
