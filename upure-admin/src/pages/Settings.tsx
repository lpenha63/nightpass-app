import { useState, useEffect } from 'react'
import { sb } from '../lib/supabase'
import { C, inp, btn, card, lbl } from '../theme'
import { Field, Toggle, Badge } from '../components/ui'
import type { PlatformConfig, DunningStep } from '../types'

const STEP_LABEL: Record<string, string> = {
  invoice_due_soon: 'Lembrete de vencimento',
  invoice_due_today: 'Vence hoje',
  invoice_overdue: 'Aviso de atraso',
  invoice_overdue_final: 'Aviso final',
}

export function Settings() {
  const [cfg, setCfg] = useState<PlatformConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    sb.from('saas_platform_config').select('*').eq('id', 1).maybeSingle()
      .then(r => { if (r.error) setErr(r.error.message); else setCfg(r.data as PlatformConfig) })
  }, [])

  if (err) return <div style={{ color: C.red, fontSize: 13, padding: 20 }}>⚠️ {err}</div>
  if (!cfg) return <div style={{ color: C.mut, fontSize: 13, padding: 40, textAlign: 'center' }}>Carregando…</div>

  const set = <K extends keyof PlatformConfig>(k: K, v: PlatformConfig[K]) => setCfg({ ...cfg, [k]: v })

  async function save() {
    if (!cfg) return
    setBusy(true); setMsg(''); setErr('')
    const { error } = await sb.from('saas_platform_config').update({
      company_name: cfg.company_name || null,
      wa_api_url: cfg.wa_api_url || null,
      wa_instance: cfg.wa_instance || null,
      wa_api_key: cfg.wa_api_key || null,
      wa_active: cfg.wa_active,
      billing_day_default: cfg.billing_day_default,
      grace_days: cfg.grace_days,
    }).eq('id', 1)
    setBusy(false)
    if (error) setErr(error.message)
    else setMsg('Configurações salvas.')
  }

  const dunning: DunningStep[] = Array.isArray(cfg.dunning) ? cfg.dunning : []

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>⚙️ Configurações da plataforma</h2>

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Identificação</div>
        <Field label="Nome da empresa" hint="Aparece nas mensagens e documentos.">
          <input style={inp} value={cfg.company_name ?? ''} onChange={e => set('company_name', e.target.value)} placeholder="Ex.: Órbita Tecnologia" />
        </Field>
      </div>

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>WhatsApp da plataforma</span>
          <Badge color={cfg.wa_active ? C.grn : C.mut}>{cfg.wa_active ? 'ATIVO' : 'INATIVO'}</Badge>
        </div>
        <div style={{ color: C.mut, fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
          Esta é a instância que <b>você</b> usa para falar com seus clientes — separada das instâncias
          que cada casa usa para falar com os clientes dela. Use um número dedicado.
        </div>
        <Field label="URL da Evolution API">
          <input style={inp} value={cfg.wa_api_url ?? ''} onChange={e => set('wa_api_url', e.target.value)} placeholder="https://evolution.seudominio.com" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Nome da instância">
            <input style={inp} value={cfg.wa_instance ?? ''} onChange={e => set('wa_instance', e.target.value)} placeholder="plataforma" />
          </Field>
          <Field label="API key">
            <input style={inp} type="password" value={cfg.wa_api_key ?? ''} onChange={e => set('wa_api_key', e.target.value)} />
          </Field>
        </div>
        <Toggle label="Enviar mensagens automaticamente" checked={cfg.wa_active} onChange={v => set('wa_active', v)} />
      </div>

      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Cobrança</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Dia de vencimento padrão" hint="Usado ao cadastrar cliente novo (1 a 28).">
            <input style={inp} inputMode="numeric" value={String(cfg.billing_day_default)}
              onChange={e => set('billing_day_default', Number(e.target.value) || 10)} />
          </Field>
          <Field label="Dias de carência" hint="Prazo após o vencimento antes de suspender o acesso.">
            <input style={inp} inputMode="numeric" value={String(cfg.grace_days)}
              onChange={e => set('grace_days', Number(e.target.value) || 0)} />
          </Field>
        </div>

        <label style={{ ...lbl, marginTop: 8 }}>RÉGUA DE COBRANÇA</label>
        <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12 }}>
          {dunning.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 12 }}>
              <span style={{
                background: s.offset < 0 ? C.acc + '22' : s.offset === 0 ? C.gold + '22' : C.red + '22',
                color: s.offset < 0 ? C.acc : s.offset === 0 ? C.gold : C.red,
                borderRadius: 6, padding: '2px 9px', fontWeight: 800, minWidth: 62, textAlign: 'center',
              }}>
                {s.offset === 0 ? 'no dia' : s.offset < 0 ? `D${s.offset}` : `D+${s.offset}`}
              </span>
              <span style={{ color: C.sub }}>{STEP_LABEL[s.template] ?? s.template}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 12, borderTop: `1px solid ${C.brd}`, marginTop: 6, paddingTop: 8 }}>
            <span style={{ background: C.red + '22', color: C.red, borderRadius: 6, padding: '2px 9px', fontWeight: 800, minWidth: 62, textAlign: 'center' }}>
              D+{cfg.grace_days}
            </span>
            <span style={{ color: C.sub }}>Suspende o acesso</span>
          </div>
        </div>
        <div style={{ color: C.mut, fontSize: 11, marginTop: 8 }}>
          O texto de cada etapa é editável em <b>Comunicação → Modelos</b>.
        </div>
      </div>

      {msg && <div style={{ color: C.grn, fontSize: 13, marginBottom: 10 }}>✓ {msg}</div>}
      {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>⚠️ {err}</div>}
      <button style={btn} disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar configurações'}</button>
    </div>
  )
}
