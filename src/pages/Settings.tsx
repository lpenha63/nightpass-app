import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn } from '../components/ui'
import { sT, type ToastState } from '../utils/toast'
import { fmtWAPhone } from '../utils/whatsapp'
import { useTheme } from '../hooks/useTheme'
import { SubscriptionSection } from '../components/SubscriptionGate'
import { painelUnidadesLigado, setPainelUnidades } from '../hooks/useSession'
import { APP_BUILD } from '../components/UpdateBar'
import { SetupGuide } from '../components/SetupGuide'
import type { House, WhatsAppConfig, Session, SaasSubscription } from '../types'

interface Props {
  house: House
  session?: Session
  sub?: SaasSubscription | null
  refreshSub?: () => void
}

interface HouseConfig {
  // Empresa
  name: string
  cnpj: string
  phone: string
  email: string
  website: string
  address: string
  city: string
  state: string
  logo_url: string
  // PIX
  pix_key: string
  pix_holder: string
  // Mercado Pago
  mp_access_token: string
}

const WDEF: WhatsAppConfig = {
  house_id: '', instance_name: '', api_url: '', api_key: '', active: false,
  send_checkin_confirm: true, send_birthday_wish: true, send_event_invite: false,
}

const EMPTY: HouseConfig = {
  name: '', cnpj: '', phone: '', email: '', website: '',
  address: '', city: '', state: '', logo_url: '',
  pix_key: '', pix_holder: '', mp_access_token: '',
}

const BR_STATES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 14, borderBottom: `1px solid ${C.brd}` }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ color: C.txt, fontWeight: 800, fontSize: 16 }}>{title}</span>
      </div>
      {children}
    </Card>
  )
}

function Field({ label, hint, half, children }: { label: string; hint?: string; half?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, ...(half ? {} : {}) }}>
      <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 5, letterSpacing: '0.07em' }}>{label}</label>
      {children}
      {hint && <div style={{ color: C.mut, fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function fmtCNPJ(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14)
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
         .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})$/, '$1.$2.$3/$4')
         .replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2.$3')
         .replace(/^(\d{2})(\d{3})$/, '$1.$2')
         .replace(/^(\d{2})$/, '$1')
}

export function SettingsPage({ house, session, sub, refreshSub }: Props) {
  const INP: React.CSSProperties = {
    width: '100%', background: C.bg, border: `1px solid ${C.brd}`,
    borderRadius: 10, padding: '10px 13px', color: C.txt, fontSize: 14,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  }
  const { theme, setTheme } = useTheme()
  const [config, setConfig] = useState<HouseConfig>(EMPTY)
  const [waConfig, setWaConfig] = useState<WhatsAppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingWa, setSavingWa] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [showMpToken, setShowMpToken] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testingMp, setTestingMp] = useState(false)
  const [testingWa, setTestingWa] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [mpStatus, setMpStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [waStatus, setWaStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const logoRef = useRef<HTMLInputElement>(null)
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [currentPass, setCurrentPass] = useState('')
  const [changingPass, setChangingPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)
  const [myEmail, setMyEmail] = useState('')
  const [painelOn, setPainelOn] = useState(painelUnidadesLigado())
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [instanceStatus, setInstanceStatus] = useState<'unknown' | 'open' | 'close' | 'connecting'>('unknown')
  const qrInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopQrPolling() {
    if (qrInterval.current) { clearInterval(qrInterval.current); qrInterval.current = null }
  }

  async function checkInstanceStatus() {
    if (!waConfig?.api_url || !waConfig.instance_name || !waConfig.api_key) return
    try {
      const res = await fetch(`${waConfig.api_url}/instance/connectionState/${waConfig.instance_name}`, {
        headers: { apikey: waConfig.api_key },
      })
      const data = await res.json()
      const state = data?.instance?.state ?? data?.state ?? 'unknown'
      setInstanceStatus(state)
      if (state === 'open') { setQrCode(null); stopQrPolling(); sT(setToast, '✅ WhatsApp conectado com sucesso!', 'success') }
    } catch { /* silently ignore */ }
  }

  async function createAndConnect() {
    if (!waConfig?.api_url || !waConfig.instance_name || !waConfig.api_key) {
      sT(setToast, 'Preencha e salve API URL, Instância e API Key antes de conectar', 'warn'); return
    }
    setQrLoading(true); setQrCode(null); stopQrPolling()
    try {
      const headers = { 'Content-Type': 'application/json', apikey: waConfig.api_key }
      const base = waConfig.api_url.replace(/\/$/, '')
      const name = waConfig.instance_name

      // 1. Tenta criar instância (ignora erro 409 se já existe)
      const createRes = await fetch(`${base}/instance/create`, {
        method: 'POST', headers,
        body: JSON.stringify({ instanceName: name, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
      })
      const createData = await createRes.json()

      // 2. Extrai QR do response de criação (v2 retorna direto)
      let base64: string | null =
        createData?.qrcode?.base64 ??
        createData?.base64 ??
        createData?.qr ??
        null

      // 3. Se não veio no create, chama /instance/connect (v1)
      if (!base64) {
        const connectRes = await fetch(`${base}/instance/connect/${name}`, { headers: { apikey: waConfig.api_key } })
        const connectData = await connectRes.json()
        base64 =
          connectData?.base64 ??
          connectData?.qrcode?.base64 ??
          connectData?.code ??
          connectData?.qr ??
          null
      }

      // 4. Se ainda não veio, tenta /instance/fetchInstances e reconnect
      if (!base64) {
        await fetch(`${base}/instance/restart/${name}`, { method: 'PUT', headers: { apikey: waConfig.api_key } })
        await new Promise(r => setTimeout(r, 2000))
        const retryRes = await fetch(`${base}/instance/connect/${name}`, { headers: { apikey: waConfig.api_key } })
        const retryData = await retryRes.json()
        base64 = retryData?.base64 ?? retryData?.qrcode?.base64 ?? retryData?.code ?? null
      }

      if (base64) {
        setQrCode(base64)
        setInstanceStatus('connecting')
        qrInterval.current = setInterval(checkInstanceStatus, 3000)
      } else {
        await checkInstanceStatus()
        if (instanceStatus !== 'open') sT(setToast, '⚠️ QR não retornado. Tente clicar em "Atualizar QR" em alguns segundos.', 'warn')
      }
    } catch (e: unknown) {
      sT(setToast, '❌ Erro ao conectar: ' + (e instanceof Error ? e.message : 'verifique a URL'), 'error')
    }
    setQrLoading(false)
  }

  async function disconnectInstance() {
    if (!waConfig?.api_url || !waConfig.instance_name || !waConfig.api_key) return
    if (!confirm('Desconectar o WhatsApp desta instância?')) return
    stopQrPolling(); setQrCode(null)
    try {
      await fetch(`${waConfig.api_url}/instance/logout/${waConfig.instance_name}`, {
        method: 'DELETE', headers: { apikey: waConfig.api_key },
      })
      setInstanceStatus('close')
      sT(setToast, 'WhatsApp desconectado.', 'success')
    } catch { sT(setToast, '❌ Erro ao desconectar', 'error') }
  }

  // Checa status ao carregar e limpa polling ao desmontar
  useEffect(() => { return () => stopQrPolling() }, [])

  async function changePassword() {
    if (!currentPass) { sT(setToast, 'Informe a senha atual', 'error'); return }
    if (newPass.length < 6) { sT(setToast, 'A nova senha deve ter ao menos 6 caracteres', 'error'); return }
    if (newPass !== confirmPass) { sT(setToast, 'As senhas não conferem', 'error'); return }
    setChangingPass(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const email = session?.user?.email ?? myEmail
      if (!session || !email) { sT(setToast, 'Sessão expirada. Saia e entre novamente.', 'error'); setChangingPass(false); return }
      // Verifica a senha atual reautenticando
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: currentPass })
      if (authErr) { sT(setToast, 'Senha atual incorreta.', 'error'); setChangingPass(false); return }
      const { error } = await supabase.auth.updateUser({ password: newPass })
      if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); setChangingPass(false); return }
      setNewPass(''); setConfirmPass(''); setCurrentPass(''); setChangingPass(false)
      sT(setToast, '✅ Senha alterada! Faça login novamente com a nova senha.', 'success')
      setTimeout(async () => { await supabase.auth.signOut(); window.location.reload() }, 1800)
    } catch (e) {
      setChangingPass(false)
      sT(setToast, 'Erro: ' + ((e as Error)?.message ?? 'falha ao alterar'), 'error')
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.reload()
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyEmail(data.user?.email ?? ''))
  }, [])

  useEffect(() => {
    Promise.all([
      supabase.from('houses').select('*').eq('id', house.id).single(),
      supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1),
    ]).then(([hr, wr]) => {
      if (hr.data) {
        const d = hr.data
        setConfig({
          name: d.name ?? '', cnpj: d.cnpj ?? '', phone: d.phone ?? '',
          email: d.email ?? '', website: d.website ?? '', address: d.address ?? '',
          city: d.city ?? '', state: d.state ?? '', logo_url: d.logo_url ?? '',
          pix_key: d.pix_key ?? '', pix_holder: d.pix_holder ?? '',
          mp_access_token: d.mp_access_token ?? '',
        })
      }
      if (wr.data?.length) setWaConfig(wr.data[0])
      else setWaConfig({ ...WDEF, house_id: house.id })
      setLoading(false)
    })
  }, [house.id])

  function set(key: keyof HouseConfig) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setConfig(p => ({ ...p, [key]: e.target.value }))
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { sT(setToast, 'Logo muito grande. Máx 2MB', 'warn'); return }
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${house.id}/logo.${ext}`
    const { error: upErr } = await supabase.storage.from('logos').upload(path, file, { upsert: true })
    if (upErr) { sT(setToast, 'Erro no upload: ' + upErr.message, 'error'); setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(path)
    setConfig(p => ({ ...p, logo_url: publicUrl + '?t=' + Date.now() }))
    sT(setToast, '✅ Logo enviado!', 'success')
    setUploading(false)
  }

  // Local da casa para validar o ponto batido pelo app da equipe (por estabelecimento)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geo, setGeo] = useState({ lat: '', lng: '', radius: '250' })
  useEffect(() => {
    supabase.from('houses').select('lat,lng,clock_radius_m').eq('id', house.id).maybeSingle()
      .then(r => {
        if (!r.data) return
        setGeo({
          lat: r.data.lat != null ? String(r.data.lat) : '',
          lng: r.data.lng != null ? String(r.data.lng) : '',
          radius: String(r.data.clock_radius_m ?? 250),
        })
      })
  }, [house.id])

  function captureHouseLocation() {
    if (!navigator.geolocation) { sT(setToast, 'Este navegador não tem GPS — digite as coordenadas abaixo.', 'error'); return }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(pos => {
      setGeoBusy(false)
      setGeo(g => ({ ...g, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }))
      sT(setToast, '📍 Coordenadas capturadas — clique em 💾 Salvar local.', 'success')
    }, err => {
      setGeoBusy(false)
      // Mensagem por motivo — o erro genérico não dizia o que fazer
      const msg = err.code === err.PERMISSION_DENIED
        ? 'Localização bloqueada. Libere no cadeado 🔒 da barra de endereço (ou use as coordenadas do Google Maps abaixo).'
        : err.code === err.POSITION_UNAVAILABLE
          ? 'GPS indisponível neste aparelho (comum em PC). Cole as coordenadas do Google Maps abaixo.'
          : 'Demorou para localizar. Tente de novo ou cole as coordenadas do Google Maps abaixo.'
      sT(setToast, msg, 'warn')
    },
    { enableHighAccuracy: true, timeout: 12000 })
  }

  // Busca as coordenadas a partir do endereço já cadastrado. É o caminho mais
  // prático no PC, onde o GPS do navegador costuma não funcionar.
  const [geoAddrBusy, setGeoAddrBusy] = useState(false)
  async function buscarPorEndereco() {
    if (!config.address.trim() || !config.city.trim()) {
      sT(setToast, 'Preencha o endereço e a cidade acima antes de buscar.', 'warn'); return
    }
    setGeoAddrBusy(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const r = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token ?? ''}` },
        body: JSON.stringify({
          address: config.address, city: config.city, state: config.state,
          house_id: house.id,
          // O nome ajuda a achar o próprio estabelecimento em vez do meio da rua
          house_name: config.name || house.name,
        }),
      })
      const d = await r.json().catch(() => null)
      if (!d?.ok) { sT(setToast, d?.error ?? 'Não foi possível localizar o endereço.', 'error'); return }
      setGeo(g => ({ ...g, lat: d.melhor.lat.toFixed(6), lng: d.melhor.lng.toFixed(6) }))
      sT(setToast, d.aproximado
        ? '📍 Achei só a via, sem o número — confira no mapa antes de salvar.'
        : `📍 ${String(d.melhor.rotulo).split(',').slice(0, 2).join(',')} — confira no mapa e salve.`,
        d.aproximado ? 'warn' : 'success')
    } catch {
      sT(setToast, 'Erro de conexão ao buscar o endereço.', 'error')
    } finally { setGeoAddrBusy(false) }
  }

  // Aceita "-23.55052, -46.63331" colado do Google Maps
  function pasteCoords(v: string) {
    const m = v.match(/(-?\d+[.,]\d+)\s*[,;]\s*(-?\d+[.,]\d+)/)
    if (m) setGeo(g => ({ ...g, lat: m[1].replace(',', '.'), lng: m[2].replace(',', '.') }))
  }

  // O "Limpar" só apagava os campos na tela; agora remove do banco também,
  // senão o ponto continuava sendo validado pelo local antigo.
  async function removerHouseLocation() {
    const { error } = await supabase.from('houses')
      .update({ lat: null, lng: null }).eq('id', house.id)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    setGeo(g => ({ ...g, lat: '', lng: '' }))
    sT(setToast, 'Local removido — o ponto passa a ser registrado sem verificação.', 'success')
  }

  async function saveHouseLocation() {
    const lat = parseFloat(geo.lat), lng = parseFloat(geo.lng)
    const radius = Math.max(30, parseInt(geo.radius) || 250)
    // Sem coordenadas o update gravava null e avisava "local removido" — parecia
    // que o salvar não funcionava. Agora diz o que falta fazer.
    if (!geo.lat.trim() && !geo.lng.trim()) {
      sT(setToast, 'Nenhuma coordenada preenchida. Use 🏠 Buscar pelo endereço ou 📍 Usar localização atual.', 'warn')
      return
    }
    if (isNaN(lat) || isNaN(lng)) { sT(setToast, 'Coordenadas inválidas — confira latitude e longitude.', 'warn'); return }
    const { error } = await supabase.from('houses')
      .update({ lat, lng, clock_radius_m: radius }).eq('id', house.id)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    sT(setToast, `📍 Local salvo — ponto válido num raio de ${radius}m.`, 'success')
  }

  async function saveHouse() {
    setSaving(true)
    const { error } = await supabase.from('houses').update({
      name: config.name.trim() || house.name,
      cnpj: config.cnpj.replace(/\D/g, '') || null,
      phone: config.phone.replace(/\D/g, '') || null,
      email: config.email.trim() || null,
      website: config.website.trim() || null,
      address: config.address.trim() || null,
      city: config.city.trim() || null,
      state: config.state || null,
      logo_url: config.logo_url || null,
      pix_key: config.pix_key.trim() || null,
      pix_holder: config.pix_holder.trim() || null,
      mp_access_token: config.mp_access_token.trim() || null,
    }).eq('id', house.id)
    setSaving(false)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    sT(setToast, '✅ Configurações salvas!', 'success')
    setMpStatus('idle')
  }

  async function saveWa() {
    if (!waConfig) return
    setSavingWa(true)
    const data = { ...waConfig, house_id: house.id }
    const q = waConfig.id
      ? supabase.from('whatsapp_config').update(data).eq('id', waConfig.id)
      : supabase.from('whatsapp_config').insert(data).select().single()
    const r = await q
    if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error') }
    else {
      if (!waConfig.id && 'data' in r && r.data) setWaConfig(r.data as WhatsAppConfig)
      sT(setToast, '✅ WhatsApp salvo!', 'success')
      setWaStatus('idle')
    }
    setSavingWa(false)
  }

  async function testMp() {
    if (!config.mp_access_token.trim()) { sT(setToast, 'Insira o token antes de testar', 'warn'); return }
    setTestingMp(true); setMpStatus('idle')
    try {
      // Pelo servidor: a API do Mercado Pago não manda cabeçalho CORS, então o mesmo
      // fetch feito daqui do navegador é bloqueado e sempre dava "erro de conexão".
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/mp-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess?.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ house_id: house.id, token: config.mp_access_token.trim() }),
      })
      const d = await res.json().catch(() => null)
      if (d?.ok) {
        setMpStatus('ok')
        sT(setToast, `✅ Conta: ${d.nickname ?? d.email ?? 'conectada'}${d.site && d.site !== 'MLB' ? ` (atenção: conta ${d.site}, não Brasil)` : ''}`, 'success')
      } else {
        setMpStatus('error')
        sT(setToast, `❌ ${d?.error ?? 'Token inválido'}`, 'error')
      }
    } catch { setMpStatus('error'); sT(setToast, '❌ Erro de conexão', 'error') }
    setTestingMp(false)
  }

  async function testWa() {
    if (!waConfig?.api_url || !waConfig.instance_name || !waConfig.api_key) { sT(setToast, 'Preencha URL, instância e API Key', 'warn'); return }
    if (!testPhone) { sT(setToast, 'Digite um telefone para teste', 'warn'); return }
    const fph = fmtWAPhone(testPhone)
    if (!fph) { sT(setToast, 'Telefone inválido', 'warn'); return }
    setTestingWa(true); setWaStatus('idle')
    try {
      const res = await fetch(`${waConfig.api_url}/message/sendText/${waConfig.instance_name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: waConfig.api_key },
        body: JSON.stringify({ number: fph, text: '✅ NightPass conectado! Sua integração WhatsApp está funcionando.' }),
      }).then(r => r.json())
      if (res?.key) { setWaStatus('ok'); sT(setToast, '✅ WhatsApp conectado!', 'success') }
      else { setWaStatus('error'); sT(setToast, '❌ Falha: ' + JSON.stringify(res), 'error') }
    } catch (e: unknown) { setWaStatus('error'); sT(setToast, '❌ Erro: ' + (e instanceof Error ? e.message : 'desconhecido'), 'error') }
    setTestingWa(false)
  }

  function setWa(key: keyof WhatsAppConfig) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setWaConfig(p => p ? { ...p, [key]: e.target.value } : p)
  }

  if (loading) return <div style={{ color: C.mut, padding: 40, textAlign: 'center' }}>Carregando...</div>

  const statusBtn = (status: 'idle'|'ok'|'error', idle: string, testing: boolean, label = 'Testando...') => ({
    style: {
      background: 'transparent',
      border: `1px solid ${status === 'ok' ? C.grn : status === 'error' ? C.red : C.brd}`,
      color: status === 'ok' ? C.grn : status === 'error' ? C.red : C.mut,
      borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700,
      cursor: testing ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
    } as React.CSSProperties,
    children: testing ? label : status === 'ok' ? '✅ Conectado' : status === 'error' ? '❌ Inválido' : idle,
  })

  return (
    <div style={{ maxWidth: 700, paddingBottom: 80 }}>
      <Toast toast={toast} />
      <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, marginBottom: 4 }}>⚙️ Configurações</h1>
      <p style={{ color: C.mut, fontSize: 14, marginBottom: 20 }}>Dados e integrações do estabelecimento</p>

      {/* Guia de configuração: verifica o que falta e ensina o passo a passo */}
      <SetupGuide houseId={house.id} />

      {/* ── EMPRESA ── */}
      {/* ── Aparência (tema claro/escuro) ── */}
      <Section title="Aparência" icon="🎨">
        <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 8, letterSpacing: '0.07em' }}>TEMA</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {([['dark', '🌙 Escuro'], ['light', '☀️ Claro']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTheme(t)}
              style={{
                flex: '1 1 160px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px 16px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 14, fontWeight: 800,
                border: `2px solid ${theme === t ? C.acc : C.brd}`,
                background: theme === t ? C.acc + '18' : C.bg,
                color: theme === t ? C.acc : C.sub,
              }}>
              {label}{theme === t ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <div style={{ color: C.mut, fontSize: 11, marginTop: 8 }}>A preferência fica salva neste dispositivo.</div>
      </Section>

      {/* ── Multi-unidades: só faz sentido para quem tem mais de uma casa ── */}
      {(session?.houses?.length ?? 0) > 1 && (
        <Section title="Multi-unidades" icon="🏠">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>Painel das unidades no Dashboard</div>
              <div style={{ color: C.mut, fontSize: 12, marginTop: 3 }}>
                Mostra um resumo de cada uma das suas {session?.houses?.length} unidades — próximo evento, reservas,
                check-ins e faturamento do dia — logo acima do Dashboard.
              </div>
            </div>
            <button
              onClick={() => { const v = !painelOn; setPainelOn(v); setPainelUnidades(v) }}
              aria-label="Exibir o painel das unidades"
              title={painelOn ? 'Tocar para ocultar o painel' : 'Tocar para exibir o painel'}
              style={{
                position: 'relative', width: 52, height: 30, flexShrink: 0, border: 'none',
                borderRadius: 999, cursor: 'pointer', padding: 0, fontFamily: 'inherit',
                background: painelOn ? C.grn : C.brd, transition: 'background .2s',
              }}>
              <i style={{
                position: 'absolute', top: 3, left: painelOn ? 25 : 3, width: 24, height: 24,
                borderRadius: '50%', background: '#fff', transition: 'left .2s',
              }} />
            </button>
          </div>
          <div style={{ color: C.mut, fontSize: 11, marginTop: 10 }}>
            A preferência fica salva neste dispositivo. A troca de unidade continua sempre disponível no menu lateral.
          </div>
        </Section>
      )}

      {/* ── Assinatura do NightPass (SaaS) ── */}
      {session && (
        <Section title="Assinatura NightPass" icon="💎">
          <SubscriptionSection session={session} sub={sub ?? null} refresh={refreshSub ?? (() => {})} />
        </Section>
      )}

      <Section title="Dados da Empresa" icon="🏢">
        {/* Logo */}
        <Field label="LOGOTIPO">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 14, border: `2px dashed ${C.brd}`,
              background: C.bg, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {config.logo_url
                ? <img loading="lazy" decoding="async" src={config.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 28, opacity: 0.3 }}>🏠</span>
              }
            </div>
            <div>
              <button onClick={() => logoRef.current?.click()} disabled={uploading}
                style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, color: C.acc, borderRadius: 10, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'block', marginBottom: 6 }}>
                {uploading ? '⏳ Enviando...' : '📤 Enviar logo'}
              </button>
              <div style={{ color: C.mut, fontSize: 11 }}>JPG, PNG ou WebP · Máx 2MB</div>
            </div>
          </div>
          <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={uploadLogo} />
        </Field>

        <Field label="NOME DO ESTABELECIMENTO">
          <input style={INP} value={config.name} onChange={set('name')} placeholder="Nome da casa noturna" />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="CNPJ">
            <input style={INP} value={fmtCNPJ(config.cnpj)} onChange={e => setConfig(p => ({ ...p, cnpj: e.target.value.replace(/\D/g, '').slice(0, 14) }))} placeholder="00.000.000/0000-00" />
          </Field>
          <Field label="TELEFONE">
            <input style={INP} type="tel" value={config.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
          </Field>
          <Field label="E-MAIL">
            <input style={INP} type="email" value={config.email} onChange={set('email')} placeholder="contato@suacasa.com.br" />
          </Field>
          <Field label="SITE">
            <input style={INP} value={config.website} onChange={set('website')} placeholder="https://suacasa.com.br" />
          </Field>
        </div>

        <Field label="ENDEREÇO">
          <input style={INP} value={config.address} onChange={set('address')} placeholder="Rua, número, bairro" />
        </Field>

        {/* Local do estabelecimento — valida o ponto batido pelo app da equipe */}
        <Field label="📍 LOCAL PARA O PONTO DA EQUIPE">
          <div style={{ background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <button type="button" onClick={buscarPorEndereco} disabled={geoAddrBusy}
                title="Usa o endereço preenchido acima para achar as coordenadas"
                style={{ background: C.grn + '18', border: `1px solid ${C.grn}55`, color: C.grn, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: geoAddrBusy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {geoAddrBusy ? 'Buscando…' : '🏠 Buscar pelo endereço'}
              </button>
              <button type="button" onClick={captureHouseLocation} disabled={geoBusy}
                style={{ background: C.acc + '18', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: geoBusy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {geoBusy ? 'Obtendo…' : '📍 Usar localização atual'}
              </button>
              <input placeholder="ou cole do Google Maps: -23.55052, -46.63331"
                onChange={e => pasteCoords(e.target.value)}
                style={{ ...INP, flex: '1 1 240px', minWidth: 0 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 8 }}>
              <div>
                <label style={{ fontSize: 10, color: C.mut, fontWeight: 700 }}>LATITUDE</label>
                <input value={geo.lat} onChange={e => setGeo(g => ({ ...g, lat: e.target.value }))} placeholder="-23.550520" style={INP} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: C.mut, fontWeight: 700 }}>LONGITUDE</label>
                <input value={geo.lng} onChange={e => setGeo(g => ({ ...g, lng: e.target.value }))} placeholder="-46.633308" style={INP} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: C.mut, fontWeight: 700 }}>RAIO</label>
                <select value={geo.radius} onChange={e => setGeo(g => ({ ...g, radius: e.target.value }))} style={{ ...INP, appearance: 'none' }}>
                  <option value="100">100 m</option>
                  <option value="250">250 m</option>
                  <option value="500">500 m</option>
                  <option value="1000">1 km</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={saveHouseLocation}
                style={{ background: `linear-gradient(135deg,${C.grn},#059669)`, border: 'none', color: '#fff', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                💾 Salvar local
              </button>
              {geo.lat && (
                <button type="button" onClick={removerHouseLocation}
                  style={{ background: 'none', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Limpar
                </button>
              )}
              {geo.lat && geo.lng && (
                <a href={`https://www.google.com/maps?q=${geo.lat},${geo.lng}`} target="_blank" rel="noreferrer"
                   style={{ alignSelf: 'center', color: C.acc, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                  🗺️ Conferir no mapa
                </a>
              )}
              <span style={{ color: geo.lat ? C.grn : C.mut, fontSize: 12, fontWeight: 600, alignSelf: 'center' }}>
                {geo.lat ? `✅ Ponto verificado num raio de ${geo.radius}m` : 'Sem local — ponto registrado sem verificação'}
              </span>
            </div>
            <div style={{ color: C.mut, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
              Cada estabelecimento tem seu próprio local e raio. Capture estando <b>dentro da casa</b>, ou cole as coordenadas
              do Google Maps (clique com o botão direito no ponto do mapa → as coordenadas aparecem no topo).
            </div>
          </div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 14 }}>
          <Field label="CIDADE">
            <input style={INP} value={config.city} onChange={set('city')} placeholder="São Paulo" />
          </Field>
          <Field label="UF">
            <select style={{ ...INP, appearance: 'none' }} value={config.state} onChange={set('state')}>
              <option value="">--</option>
              {BR_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      {/* ── PIX ── */}
      <Section title="Pagamento PIX Manual" icon="💳">
        <div style={{ background: C.acc + '10', border: `1px solid ${C.acc}22`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: C.sub }}>
          Usado quando o Mercado Pago não está configurado. O comprador vê esta chave na página de compra.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="CHAVE PIX" hint="CPF, CNPJ, e-mail, telefone ou chave aleatória">
            <input style={INP} value={config.pix_key} onChange={set('pix_key')} placeholder="Ex: 11999999999" />
          </Field>
          <Field label="FAVORECIDO" hint="Nome que aparece para o comprador">
            <input style={INP} value={config.pix_holder} onChange={set('pix_holder')} placeholder="Nome ou razão social" />
          </Field>
        </div>
      </Section>

      {/* ── MERCADO PAGO ── */}
      <Section title="Mercado Pago" icon="🤖">
        <div style={{ background: C.grn + '10', border: `1px solid ${C.grn}22`, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ color: C.grn, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>✅ Ingresso liberado automaticamente após pagamento</div>
          <div style={{ color: C.sub, fontSize: 12, lineHeight: 1.6 }}>
            1. Acesse <span style={{ color: C.acc }}>developers.mercadopago.com.br</span><br />
            2. Crie um app em "Suas integrações"<br />
            3. Copie o <strong style={{ color: C.sub }}>Access Token de produção</strong> (APP_USR-...)
          </div>
        </div>
        <Field label="ACCESS TOKEN">
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...INP, flex: 1, fontFamily: showMpToken ? 'monospace' : 'inherit' }}
              type={showMpToken ? 'text' : 'password'} value={config.mp_access_token} onChange={set('mp_access_token')}
              placeholder="APP_USR-..." autoComplete="off" />
            <button onClick={() => setShowMpToken(p => !p)}
              style={{ background: C.bg, border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 10, padding: '0 12px', cursor: 'pointer', fontSize: 15, flexShrink: 0 }}>
              {showMpToken ? '🙈' : '👁️'}
            </button>
          </div>
        </Field>
        <button onClick={testMp} disabled={testingMp || !config.mp_access_token.trim()} {...statusBtn(mpStatus, '🔍 Testar token', testingMp)}>
          {statusBtn(mpStatus, '🔍 Testar token', testingMp).children}
        </button>
      </Section>

      {/* ── WHATSAPP ── */}
      <Section title="Integração WhatsApp" icon="💬">
        <div style={{ background: C.acc + '10', border: `1px solid ${C.acc}22`, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ color: C.sub, fontSize: 12, lineHeight: 1.6 }}>
            Use <strong style={{ color: C.sub }}>Evolution API</strong> (self-hosted) ou qualquer provedor compatível.<br />
            Após configurar, os disparos automáticos ficam na aba <span style={{ color: C.acc }}>💬 WhatsApp</span>.
          </div>
        </div>

        {waConfig && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <label style={{ color: C.sub, fontSize: 12, fontWeight: 700 }}>ATIVO</label>
              <button onClick={() => setWaConfig(p => p ? { ...p, active: !p.active } : p)}
                style={{ width: 44, height: 24, borderRadius: 12, border: 'none', background: waConfig.active ? C.grn : C.brd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 3, left: waConfig.active ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
              </button>
              <span style={{ color: waConfig.active ? C.grn : C.mut, fontSize: 12, fontWeight: 600 }}>
                {waConfig.active ? 'Ativado' : 'Desativado'}
              </span>
            </div>

            <Field label="API URL">
              <input style={INP} value={waConfig.api_url} onChange={setWa('api_url')} placeholder="https://api.seuserver.com" />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="NOME DA INSTÂNCIA">
                <input style={INP} value={waConfig.instance_name} onChange={setWa('instance_name')} placeholder="nightpass" />
              </Field>
              <Field label="API KEY">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...INP, flex: 1, fontFamily: showApiKey ? 'monospace' : 'inherit' }}
                    type={showApiKey ? 'text' : 'password'} value={waConfig.api_key} onChange={setWa('api_key')}
                    placeholder="••••••••" autoComplete="off" />
                  <button onClick={() => setShowApiKey(p => !p)}
                    style={{ background: C.bg, border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 8, padding: '0 10px', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <input style={{ ...INP, flex: 1 }} value={testPhone} onChange={e => setTestPhone(e.target.value)}
                placeholder="Telefone para teste (ex: 11999999999)" />
              <button onClick={testWa} disabled={testingWa} {...statusBtn(waStatus, '📲 Testar', testingWa, 'Testando...')}>
                {statusBtn(waStatus, '📲 Testar', testingWa, 'Testando...').children}
              </button>
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn onClick={saveWa} disabled={savingWa} variant="ghost" style={{ fontSize: 13 }}>
                {savingWa ? 'Salvando...' : '💾 Salvar WhatsApp'}
              </Btn>
              <Btn onClick={createAndConnect} disabled={qrLoading} style={{ fontSize: 13, background: '#25d36622', border: '1px solid #25d36644', color: '#25d366' }}>
                {qrLoading ? '⏳ Aguarde...' : instanceStatus === 'open' ? '✅ Conectado' : '📱 Conectar WhatsApp'}
              </Btn>
              {instanceStatus === 'open' && (
                <Btn onClick={disconnectInstance} variant="danger" style={{ fontSize: 13 }}>🔌 Desconectar</Btn>
              )}
            </div>

            {/* QR Code */}
            {(qrCode || instanceStatus === 'connecting') && instanceStatus !== 'open' && (
              <div style={{ marginTop: 20, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 20, textAlign: 'center' }}>
                <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>📱 Escaneie o QR Code</div>
                <div style={{ color: C.mut, fontSize: 12, marginBottom: 16 }}>
                  Abra o WhatsApp → Menu → Aparelhos conectados → Conectar aparelho
                </div>
                {qrCode
                  ? <img loading="lazy" decoding="async" src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                      alt="QR Code WhatsApp"
                      style={{ width: 220, height: 220, borderRadius: 12, border: `4px solid #25d366`, display: 'block', margin: '0 auto' }} />
                  : <div style={{ width: 220, height: 220, borderRadius: 12, background: C.card, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', color: C.mut, fontSize: 13 }}>
                      ⏳ Aguardando QR...
                    </div>
                }
                <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button onClick={createAndConnect} disabled={qrLoading}
                    style={{ background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 14px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    🔄 Atualizar QR
                  </button>
                  <button onClick={() => { setQrCode(null); stopQrPolling(); setInstanceStatus('unknown') }}
                    style={{ background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 14px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✕ Fechar
                  </button>
                </div>
                <div style={{ marginTop: 10, color: C.mut, fontSize: 11 }}>
                  Verificando conexão automaticamente...
                </div>
              </div>
            )}

            {instanceStatus === 'open' && !qrCode && (
              <div style={{ marginTop: 12, background: '#25d36612', border: '1px solid #25d36633', borderRadius: 10, padding: '10px 14px', color: '#25d366', fontSize: 13, fontWeight: 600 }}>
                ✅ WhatsApp conectado e pronto para enviar mensagens.
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── LINK DE VENDA ── */}
      <Section title="Link de Venda de Ingressos" icon="🔗">
        <div style={{ color: C.sub, fontSize: 13, marginBottom: 12 }}>
          Compartilhe o link do evento com seus clientes. Gerado automaticamente em cada evento.
        </div>
        <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', color: C.mut, fontSize: 13, fontFamily: 'monospace' }}>
          {window.location.origin}/e/<span style={{ color: C.acc }}>ID_DO_EVENTO</span>
        </div>
        <div style={{ color: C.mut, fontSize: 11, marginTop: 6 }}>
          Disponível no botão 🎫 Ingressos de cada evento.
        </div>
      </Section>

      {/* ── TROCA DE SENHA ── */}
      <Section title="Troca de Senha" icon="🔒">
        <div style={{ color: C.sub, fontSize: 13, marginBottom: 14 }}>
          Confirme sua senha atual e defina uma nova senha de acesso.
        </div>
        <Field label="LOGIN (E-MAIL)">
          <input style={{ ...INP, opacity: 0.7 }} type="email" value={myEmail} readOnly autoComplete="username" />
        </Field>
        <Field label="SENHA ATUAL">
          <input style={INP} type={showNewPass ? 'text' : 'password'} value={currentPass}
            onChange={e => setCurrentPass(e.target.value)} placeholder="Sua senha atual" autoComplete="current-password" />
        </Field>
        <Field label="NOVA SENHA">
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...INP, flex: 1 }} type={showNewPass ? 'text' : 'password'} value={newPass}
              onChange={e => setNewPass(e.target.value)} placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
            <button onClick={() => setShowNewPass(s => !s)} type="button"
              style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '0 14px', color: C.mut, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              {showNewPass ? '🙈' : '👁️'}
            </button>
          </div>
        </Field>
        <Field label="CONFIRMAR NOVA SENHA">
          <input style={INP} type={showNewPass ? 'text' : 'password'} value={confirmPass}
            onChange={e => setConfirmPass(e.target.value)} placeholder="Repita a senha"
            onKeyDown={e => e.key === 'Enter' && changePassword()} autoComplete="new-password" />
        </Field>
        <Btn onClick={changePassword} disabled={changingPass || !currentPass || !newPass || !confirmPass} variant="ghost" style={{ fontSize: 13 }}>
          {changingPass ? 'Alterando...' : '🔒 Alterar Senha'}
        </Btn>
      </Section>

      <Btn onClick={saveHouse} disabled={saving} style={{ width: '100%', padding: 14, fontSize: 15 }}>
        {saving ? 'Salvando...' : '💾 Salvar Configurações'}
      </Btn>

      {/* ── SAIR DA CONTA ── */}
      <Section title="Conta" icon="👤">
        <div style={{ color: C.sub, fontSize: 13, marginBottom: 14 }}>
          Encerrar a sessão neste dispositivo.
        </div>
        <Btn onClick={logout} variant="ghost" style={{ width: '100%', color: C.red, borderColor: C.red + '55' }}>
          🚪 Sair da conta
        </Btn>
        <div
          onClick={() => { navigator.clipboard?.writeText(APP_BUILD); sT(setToast, 'Versão copiada', 'success') }}
          title="Toque para copiar — útil ao relatar um problema"
          style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.brd}`, color: C.mut, fontSize: 11, textAlign: 'center', cursor: 'pointer' }}>
          NightPass · versão <b style={{ color: C.sub, fontFamily: 'ui-monospace, monospace' }}>{APP_BUILD}</b>
        </div>
      </Section>
    </div>
  )
}
