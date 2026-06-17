import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)

// Service Worker registration — apenas em produção.
// Em dev (localhost) o SW serve assets em cache e mascara o código novo.
const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname)
if ('serviceWorker' in navigator && !isLocalhost) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Global error tracking
window.addEventListener('error', (e) => {
  console.error('[NightPass Error]', e.message, '@', `${e.filename}:${e.lineno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[NightPass Promise]', e.reason)
})
