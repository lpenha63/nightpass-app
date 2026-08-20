import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Btn } from '../components/ui'
import { _err, _succ, type ToastState } from '../utils/toast'
import { fmtWAPhone } from '../utils/whatsapp'
import { useWhatsAppStatus } from '../hooks/useWhatsAppStatus'
import type { House, WhatsAppConfig } from '../types'

interface Props { house: House }
interface Template { id?: string; type: string; body: string; active: boolean; house_id: string }
interface Log { id: string; status: string; recipient_phone: string; message_type: string; message_body: string; created_at: string }

const WDEF: WhatsAppConfig = { house_id: '', instance_name: '', api_url: '', api_key: '', active: false, send_checkin_confirm: true, send_birthday_wish: true, send_event_invite: false }
const TMPL_LABELS: Record<string, string> = { checkin_confirm: '✓ Confirmação de Check-in', birthday_wish: '🎂 Mensagem de Aniversário', event_invite: '🎉 Convite de Evento' }

export function WhatsAppPage({ house }: Props) {
  const [cfg, setCfg] = useState<WhatsAppConfig | null>(null)
  const [tmpls, setTmpls] = useState<Template[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [et, setEt] = useState<Template | null>(null)
  const [toast, _setToast] = useState<ToastState | null>(null)
  // Conexão / pareamento via QR
  const { status: waStatus, refresh: refreshWa } = useWhatsAppStatus(house.id)
  const [qr, setQr] = useState<{ base64?: string; pairingCode?: string } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [showManual, setShowManual] = useState(false)

  function load() {
    supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1)
      .then(r => setCfg(r.data?.length ? r.data[0] : { ...WDEF, house_id: house.id }))
    supabase.from('whatsapp_templates').select('*').eq('house_id', house.id).order('type')
      .then(r => setTmpls(r.data ?? []))
    supabase.from('whatsapp_logs').select('*').eq('house_id', house.id).order('created_at', { ascending: false }).limit(30)
      .then(r => setLogs(r.data ?? []))
  }

  useEffect(() => { load() }, [house.id])

  // Enquanto o QR está visível, checa a conexão a cada 3s; quando conecta, some o QR
  useEffect(() => {
    if (!qr) return
    const id = setInterval(() => { refreshWa() }, 3000)
    return () => clearInterval(id)
  }, [qr, refreshWa])
  useEffect(() => {
    if (waStatus === 'open' && qr) { setQr(null); _succ('✅ WhatsApp conectado!') }
  }, [waStatus, qr])

  // Pede o QR / código de pareamento à Evolution API (instance/connect)
  async function connectInstance() {
    if (!cfg?.api_url || !cfg.instance_name || !cfg.api_key) { _err('Preencha API URL, Instance Name e API Key'); return }
    setConnecting(true); setQr(null)
    try {
      const r = await fetch(`${cfg.api_url}/instance/connect/${cfg.instance_name}`, { headers: { apikey: cfg.api_key } })
      const j = await r.json()
      const base64 = j?.base64 ?? j?.qrcode?.base64 ?? null
      const pairingCode = j?.pairingCode ?? j?.qrcode?.pairingCode ?? null
      if (base64 || pairingCode) setQr({ base64: base64 ?? undefined, pairingCode: pairingCode ?? undefined })
      else if ((j?.instance?.state ?? j?.state) === 'open') { _succ('✅ Já está conectado!'); refreshWa() }
      else _err('Não foi possível obter o QR. Confira instância e chave.')
    } catch (e: unknown) { _err('Erro: ' + (e instanceof Error ? e.message : 'desconhecido')) }
    setConnecting(false)
  }

  // Desloga a instância (logout) — para trocar de aparelho/número
  async function disconnectInstance() {
    if (!cfg?.api_url || !cfg.instance_name || !cfg.api_key) return
    if (!confirm('Desconectar o WhatsApp desta instância?\n\nVocê precisará escanear o QR de novo para reconectar (útil ao trocar de aparelho ou número).')) return
    setConnecting(true); setQr(null)
    try {
      await fetch(`${cfg.api_url}/instance/logout/${cfg.instance_name}`, { method: 'DELETE', headers: { apikey: cfg.api_key } })
      _succ('WhatsApp desconectado. Gere um novo QR para reconectar.')
      refreshWa()
    } catch (e: unknown) { _err('Erro ao desconectar: ' + (e instanceof Error ? e.message : 'desconhecido')) }
    setConnecting(false)
  }

  async function testConn() {
    if (!cfg?.api_url || !cfg.instance_name || !cfg.api_key) { _err('Preencha API URL, Instance Name e API Key'); return }
    if (!testPhone) { _err('Digite um telefone para teste'); return }
    const fph = fmtWAPhone(testPhone)
    if (!fph) { _err('Telefone inválido'); return }
    setTesting(true)
    try {
      const { waConnectionState, waStateMessage } = await import('../utils/whatsapp')
      const st = await waConnectionState(cfg)
      if (st !== 'open') { _err('❌ ' + waStateMessage(st)); setTesting(false); return }
      const resp = await fetch(`${cfg.api_url}/message/sendText/${cfg.instance_name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
        body: JSON.stringify({ number: fph, text: '✅ NightPass conectado! Sua integração WhatsApp está funcionando.' }),
      })
      const res = await resp.json().catch(() => null)
      if (res?.key) _succ('✅ Mensagem enviada! WhatsApp conectado.')
      else if (Array.isArray(res?.response?.message) && res.response.message.some((m: { exists?: boolean }) => m?.exists === false)) _err('Este número não tem WhatsApp.')
      else _err('Falha ao enviar: ' + (res?.response?.message ? JSON.stringify(res.response.message) : (res?.message || JSON.stringify(res))))
    } catch (e: unknown) { _err('Erro de conexão com o servidor do WhatsApp: ' + (e instanceof Error ? e.message : 'desconhecido')) }
    setTesting(false)
  }

  function saveCfg() {
    if (!cfg) return
    setSaving(true)
    const data = { ...cfg, house_id: house.id, updated_at: new Date().toISOString() }
    const q = cfg.id ? supabase.from('whatsapp_config').update(data).eq('id', cfg.id) : supabase.from('whatsapp_config').insert(data)
    q.then(r => { setSaving(false); if (!r.error) load(); else _err(r.error.message) })
  }

  function saveTmpl() {
    if (!et) return
    const data = { ...et, house_id: house.id, updated_at: new Date().toISOString() }
    const q = et.id ? supabase.from('whatsapp_templates').update(data).eq('id', et.id) : supabase.from('whatsapp_templates').insert(data)
    q.then(r => { if (!r.error) { setEt(null); load() } else _err(r.error.message) })
  }

  if (!cfg) return <div style={{ padding: 40, color: C.mut }}>Carregando...</div>

  const inp = { style: { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, minHeight: 40, fontFamily: 'inherit', boxSizing: 'border-box' as const } }

  return (
    <div style={{ maxWidth: 800, paddingBottom: 40 }}>
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: C.grn + '22', color: C.grn, borderRadius: 12, padding: '12px 18px', fontSize: 13, fontWeight: 700, zIndex: 1100 }}>{toast.msg}</div>}

      <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, marginBottom: 20 }}>💬 WhatsApp</h1>

      {/* Manual & Boas Práticas */}
      <Card style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
        <button onClick={() => setShowManual(v => !v)}
          style={{ width: '100%', background: 'none', border: 'none', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit' }}>
          <span style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>📖 Manual de Conexão & Boas Práticas</span>
          <span style={{ color: C.mut, fontSize: 16 }}>{showManual ? '▼' : '▶'}</span>
        </button>
        {showManual && (
          <div style={{ padding: '0 18px 18px' }}>
            {/* 1. Como conectar */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ color: C.acc, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>📱 Como conectar (passo a passo)</div>
              {[
                'Preencha Instance Name, API URL e API Key (fornecidos pelo provedor da Evolution API) e clique em 💾 Salvar.',
                'Marque a opção "Ativo" no topo da configuração.',
                'Clique em "📱 Conectar / Gerar QR".',
                'No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho.',
                'Escaneie o QR Code que aparece na tela. O status muda para "Conectado" sozinho.',
                'Confirme enviando uma mensagem de teste para o seu número no campo "Telefone para teste".',
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: C.acc + '22', color: C.acc, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>{i + 1}</span>
                  <span style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5 }}>{step}</span>
                </div>
              ))}
              <div style={{ background: C.acc + '12', border: `1px solid ${C.acc}33`, borderRadius: 8, padding: '8px 12px', marginTop: 8, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
                💡 Use um <strong>chip dedicado</strong> (não o número pessoal). O celular precisa ficar com internet e bateria — é ele que mantém a conexão ativa.
              </div>
            </div>

            {/* 2. Regras do WhatsApp */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ color: C.gold, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>⚠️ Regras do WhatsApp (para não tomar bloqueio)</div>
              {[
                'Número não-oficial (Evolution/Baileys) vai contra os Termos do WhatsApp — o risco de bloqueio sempre existe. Use sempre um chip secundário, nunca o principal.',
                'Aquecimento: número novo começa devagar (20–50 msgs/dia na 1ª semana) e aumenta aos poucos ao longo de 2–3 semanas.',
                'Nunca dispare tudo de uma vez. Evite texto idêntico para muita gente — personalize com a variável {{name}}.',
                'Envie só para quem é seu cliente / já interagiu com você. Números que nunca te responderam denunciam mais.',
                'Deixe alguns segundos entre cada mensagem — rajadas são o que mais derruba número.',
                'Muitos bloqueios ou denúncias seguidos = número cai. Dê motivo pra pessoa querer receber.',
              ].map((rule, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: C.gold, fontSize: 13, flexShrink: 0, marginTop: 1 }}>•</span>
                  <span style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5 }}>{rule}</span>
                </div>
              ))}
            </div>

            {/* 3. Recomendações */}
            <div>
              <div style={{ color: C.grn, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>✅ Recomendações de envio</div>
              {[
                ['Melhores horários', '10h–12h e 18h–21h. Evite madrugada e horário comercial cheio.'],
                ['Personalize sempre', 'Mensagem com o nome ({{name}}) gera muito menos denúncia que texto genérico.'],
                ['Prefira os automáticos', 'Check-in e aniversário são pontuais e bem-vindos — baixo risco.'],
                ['Campanhas grandes', 'Divida em lotes menores ao longo do dia, não tudo de uma vez.'],
                ['Tenha um backup', 'Mantenha um número reserva já aquecido caso o principal caia.'],
                ['Responda quem responder', 'Interação real reduz o risco de bloqueio.'],
              ].map(([title, desc], i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: C.grn, fontSize: 13, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <span style={{ color: C.sub, fontSize: 12.5, lineHeight: 1.5 }}><strong style={{ color: C.txt }}>{title}:</strong> {desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Config */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>⚙️ Configuração — Evolution API</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!cfg.active} onChange={e => setCfg(p => p ? { ...p, active: e.target.checked } : p)} style={{ width: 16, height: 16 }} />
            <span style={{ color: cfg.active ? C.grn : C.mut, fontSize: 13, fontWeight: 600 }}>{cfg.active ? 'Ativo' : 'Inativo'}</span>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {([['instance_name', 'Instance Name', 'minha-instancia'], ['api_url', 'API URL', 'https://api.example.com'], ['api_key', 'API Key', 'sua-chave-secreta']] as const).map(([field, label, placeholder]) => (
            <div key={field} style={{ gridColumn: field === 'api_key' ? '1 / -1' : undefined }}>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
              <input {...inp} type={field === 'api_key' ? 'password' : 'text'} value={(cfg as unknown as Record<string, unknown>)[field] as string ?? ''} placeholder={placeholder}
                onChange={e => setCfg(p => p ? { ...p, [field]: e.target.value } : p)} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          {(['send_checkin_confirm', 'send_birthday_wish', 'send_event_invite'] as const).map(key => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: C.mut, fontSize: 13 }}>
              <input type="checkbox" checked={!!cfg[key]} onChange={e => setCfg(p => p ? { ...p, [key]: e.target.checked } : p)} />
              {key === 'send_checkin_confirm' ? 'Check-in' : key === 'send_birthday_wish' ? 'Aniversário' : 'Evento'}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Telefone para teste</label>
            <input {...inp} type="tel" value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="11999999999" />
          </div>
          <Btn onClick={testConn} disabled={testing} variant="secondary">🔌 {testing ? 'Testando...' : 'Testar Conexão'}</Btn>
          <Btn onClick={saveCfg} disabled={saving}>💾 {saving ? 'Salvando...' : 'Salvar'}</Btn>
        </div>
      </Card>

      {/* Conexão / QR */}
      {(() => {
        const sm = ({ open: { c: '#22c55e', t: 'Conectado' }, connecting: { c: '#f59e0b', t: 'Conectando…' }, close: { c: '#ef4444', t: 'Desconectado' }, off: { c: '#6b7280', t: 'Inativo' }, loading: { c: '#6b7280', t: 'Verificando…' } } as const)[waStatus]
        const qrSrc = qr?.base64 ? (qr.base64.startsWith('data:') ? qr.base64 : `data:image/png;base64,${qr.base64}`) : null
        return (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>🔌 Conexão</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: sm.c, boxShadow: waStatus === 'open' ? `0 0 7px ${sm.c}` : 'none' }} />
                <span style={{ color: sm.c, fontSize: 13, fontWeight: 700 }}>{sm.t}</span>
              </span>
            </div>
            {waStatus === 'open' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ color: C.grn, fontSize: 13, fontWeight: 600, flex: 1, minWidth: 180 }}>✅ Aparelho conectado e pronto para enviar mensagens.</div>
                <Btn onClick={disconnectInstance} disabled={connecting} variant="secondary" style={{ color: '#ef4444', borderColor: '#ef444455' }}>🔌 {connecting ? 'Desconectando…' : 'Desconectar'}</Btn>
              </div>
            ) : (
              <>
                <div style={{ color: C.mut, fontSize: 12, marginBottom: 10 }}>
                  Gere o QR e escaneie no celular: WhatsApp → <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong>.
                </div>
                <Btn onClick={connectInstance} disabled={connecting}>{connecting ? 'Gerando…' : (qr ? '🔄 Gerar novo QR' : '📱 Conectar / Gerar QR')}</Btn>
                {qr && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    {qrSrc && <img loading="lazy" decoding="async" src={qrSrc} alt="QR Code WhatsApp" style={{ width: 240, height: 240, borderRadius: 12, background: '#fff', padding: 8 }} />}
                    {qr.pairingCode && <div style={{ color: C.txt, fontSize: 14 }}>Código: <strong style={{ letterSpacing: 2 }}>{qr.pairingCode}</strong></div>}
                    <div style={{ color: C.gold, fontSize: 12, fontWeight: 600 }}>⏳ Aguardando leitura… conecta sozinho ao escanear.</div>
                  </div>
                )}
              </>
            )}
          </Card>
        )
      })()}

      {/* Templates */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ color: C.txt, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>📝 Templates de Mensagem</div>
        <div style={{ color: C.mut, fontSize: 12, marginBottom: 16 }}>Variáveis: {'{{name}} {{date}} {{event}} {{house}}'}</div>
        {Object.keys(TMPL_LABELS).map(type => {
          const t = tmpls.find(x => x.type === type) ?? { type, body: '', active: true, house_id: house.id }
          const isEd = et?.type === type
          return (
            <div key={type} style={{ borderBottom: `1px solid ${C.brd}`, paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: C.acc, fontSize: 12, fontWeight: 600 }}>{TMPL_LABELS[type]}</span>
                {!isEd && <Btn onClick={() => setEt({ ...t })} small variant="ghost">✏️ Editar</Btn>}
              </div>
              {isEd ? (
                <div>
                  <textarea value={et.body} rows={4} onChange={e => setEt(p => p ? { ...p, body: e.target.value } : p)}
                    style={{ width: '100%', background: C.bg, border: `1px solid ${C.acc}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <Btn onClick={saveTmpl} small>💾 Salvar</Btn>
                    <Btn onClick={() => setEt(null)} small variant="ghost">Cancelar</Btn>
                  </div>
                </div>
              ) : (
                <div style={{ background: C.bg, borderRadius: 6, padding: '8px 10px', fontSize: 12, color: t.body ? C.txt : C.mut, whiteSpace: 'pre-wrap' as const }}>
                  {t.body || '(sem template)'}
                </div>
              )}
            </div>
          )
        })}
      </Card>

      {/* Logs */}
      {logs.length > 0 && (
        <Card>
          <div style={{ color: C.txt, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>📋 Mensagens Recentes</div>
          {logs.map((lg, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.brd}` }}>
              <span style={{ color: lg.status === 'sent' ? C.grn : C.red, fontSize: 11, width: 50, flexShrink: 0, fontWeight: 700 }}>{lg.status}</span>
              <span style={{ color: C.mut, fontSize: 12, width: 110, flexShrink: 0 }}>{lg.recipient_phone}</span>
              <span style={{ color: C.mut, fontSize: 12, width: 100, flexShrink: 0 }}>{lg.message_type}</span>
              <span style={{ flex: 1, color: C.txt, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{lg.message_body}</span>
              <span style={{ color: C.mut, fontSize: 10, flexShrink: 0 }}>{lg.created_at.slice(0, 10)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
