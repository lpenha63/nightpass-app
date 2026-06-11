import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn } from '../components/ui'
import { sT, type ToastState } from '../utils/toast'
import { fmtWAPhone } from '../utils/whatsapp'
import type { House, WhatsAppConfig } from '../types'

interface Props { house: House }

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

const INP: React.CSSProperties = {
  width: '100%', background: C.bg, border: `1px solid ${C.brd}`,
  borderRadius: 10, padding: '10px 13px', color: C.txt, fontSize: 14,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

function fmtCNPJ(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14)
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
         .replace(/^(\d{2})(\d{3})(\d{3})(\d{4})$/, '$1.$2.$3/$4')
         .replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2.$3')
         .replace(/^(\d{2})(\d{3})$/, '$1.$2')
         .replace(/^(\d{2})$/, '$1')
}

export function SettingsPage({ house }: Props) {
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
  const [changingPass, setChangingPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)

  async function changePassword() {
    if (newPass.length < 6) { sT(setToast, 'A senha deve ter ao menos 6 caracteres', 'error'); return }
    if (newPass !== confirmPass) { sT(setToast, 'As senhas não conferem', 'error'); return }
    setChangingPass(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    setChangingPass(false)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    setNewPass(''); setConfirmPass('')
    sT(setToast, '✅ Senha alterada com sucesso!', 'success')
  }

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
      const res = await fetch('https://api.mercadopago.com/users/me', {
        headers: { Authorization: `Bearer ${config.mp_access_token.trim()}` },
      })
      if (res.ok) { const d = await res.json(); setMpStatus('ok'); sT(setToast, `✅ Conta: ${d.nickname ?? d.email}`, 'success') }
      else { setMpStatus('error'); sT(setToast, '❌ Token inválido', 'error') }
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
      <p style={{ color: C.mut, fontSize: 14, marginBottom: 28 }}>Dados e integrações do estabelecimento</p>

      {/* ── EMPRESA ── */}
      <Section title="Dados da Empresa" icon="🏢">
        {/* Logo */}
        <Field label="LOGOTIPO">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 14, border: `2px dashed ${C.brd}`,
              background: C.bg, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {config.logo_url
                ? <img src={config.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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

            <div style={{ marginTop: 16 }}>
              <Btn onClick={saveWa} disabled={savingWa} variant="ghost" style={{ fontSize: 13 }}>
                {savingWa ? 'Salvando...' : '💾 Salvar WhatsApp'}
              </Btn>
            </div>
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
          Disponível no botão 🎟️ Ingressos de cada evento.
        </div>
      </Section>

      {/* ── TROCA DE SENHA ── */}
      <Section title="Troca de Senha" icon="🔒">
        <div style={{ color: C.sub, fontSize: 13, marginBottom: 14 }}>
          Defina uma nova senha de acesso para o seu usuário.
        </div>
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
        <Btn onClick={changePassword} disabled={changingPass || !newPass || !confirmPass} variant="ghost" style={{ fontSize: 13 }}>
          {changingPass ? 'Alterando...' : '🔒 Alterar Senha'}
        </Btn>
      </Section>

      <Btn onClick={saveHouse} disabled={saving} style={{ width: '100%', padding: 14, fontSize: 15 }}>
        {saving ? 'Salvando...' : '💾 Salvar Configurações'}
      </Btn>
    </div>
  )
}
