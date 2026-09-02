import { useState, useEffect, useCallback, useMemo } from 'react'
import { sb } from '../lib/supabase'
import { C, inp, btn, btnGhost, card } from '../theme'
import { Pill, Badge, Empty, Modal, Field, Toggle } from '../components/ui'
import { fdate } from '../format'
import type { MessageTemplate, Message, Customer } from '../types'

const TPL_LABEL: Record<string, string> = {
  welcome: 'Boas-vindas',
  trial_ending: 'Teste acabando',
  invoice_created: 'Fatura gerada',
  invoice_due_soon: 'Vence em breve',
  invoice_due_today: 'Vence hoje',
  invoice_overdue: 'Em atraso',
  invoice_overdue_final: 'Aviso final',
  subscription_suspended: 'Acesso suspenso',
  payment_received: 'Pagamento recebido',
}
const MSG_COLOR: Record<string, string> = { queued: C.gold, sent: C.grn, failed: C.red, canceled: C.mut }
const MSG_LABEL: Record<string, string> = { queued: 'Na fila', sent: 'Enviada', failed: 'Falhou', canceled: 'Cancelada' }

export function Messages({ customers }: { customers: Customer[] }) {
  const [tab, setTab] = useState<'templates' | 'historico'>('templates')
  const [tpls, setTpls] = useState<MessageTemplate[]>([])
  const [msgs, setMsgs] = useState<Message[]>([])
  const [edit, setEdit] = useState<MessageTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')

  const load = useCallback(async () => {
    const [t, m] = await Promise.all([
      sb.from('saas_message_templates').select('*').order('key'),
      sb.from('saas_messages').select('*').order('created_at', { ascending: false }).limit(100),
    ])
    setTpls((t.data ?? []) as MessageTemplate[])
    setMsgs((m.data ?? []) as Message[])
  }, [])
  useEffect(() => { load() }, [load])

  const custName = useMemo(() => {
    const map = new Map(customers.map(c => [c.id, c.name]))
    return (id: string) => map.get(id) ?? '—'
  }, [customers])

  const fila = msgs.filter(m => m.status === 'queued').length

  async function enviarAgora() {
    setBusy(true); setInfo('')
    const { data, error } = await sb.functions.invoke('saas-notify', { body: {} })
    setBusy(false)
    setInfo(error
      ? `Erro: ${error.message}`
      : data?.skipped
        ? `${data.skipped} — ative o WhatsApp em Configurações.`
        : `${data?.sent ?? 0} enviada(s), ${data?.failed ?? 0} com falha.`)
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>💬 Comunicação</h2>
        {fila > 0 && <Badge color={C.gold}>{fila} na fila</Badge>}
        <div style={{ flex: 1 }} />
        <button style={btn} disabled={busy} onClick={enviarAgora}>{busy ? 'Enviando…' : '📤 Enviar fila agora'}</button>
      </div>

      {info && (
        <div style={{ background: C.acc + '18', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 10, padding: '9px 14px', fontSize: 13, marginBottom: 14 }}>
          {info}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Pill active={tab === 'templates'} onClick={() => setTab('templates')}>Modelos</Pill>
        <Pill active={tab === 'historico'} onClick={() => setTab('historico')}>Histórico</Pill>
      </div>

      {tab === 'templates' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {tpls.length === 0 && <Empty>Nenhum modelo cadastrado.</Empty>}
          {tpls.map(t => (
            <div key={t.id} style={{ ...card, opacity: t.active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 14, flex: 1 }}>{TPL_LABEL[t.key] ?? t.key}</span>
                {!t.active && <Badge color={C.mut}>OFF</Badge>}
              </div>
              <div style={{
                background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 10,
                fontSize: 12, color: C.sub, whiteSpace: 'pre-wrap', minHeight: 90, marginBottom: 10, lineHeight: 1.5,
              }}>
                {t.body}
              </div>
              <button style={{ ...btnGhost, width: '100%', padding: '7px 0' }} onClick={() => setEdit(t)}>Editar</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {msgs.length === 0 && <Empty>Nenhuma mensagem enviada ainda.</Empty>}
          {msgs.map(m => (
            <div key={m.id} style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}55` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{custName(m.customer_id)}</span>
                <span style={{ color: C.mut, fontSize: 11 }}>{m.to_addr}</span>
                <Badge color={MSG_COLOR[m.status] ?? C.mut}>{MSG_LABEL[m.status] ?? m.status}</Badge>
                {m.template_key && <span style={{ color: C.mut, fontSize: 11 }}>{TPL_LABEL[m.template_key] ?? m.template_key}</span>}
                <div style={{ flex: 1 }} />
                <span style={{ color: C.mut, fontSize: 11 }}>{fdate(m.sent_at ?? m.created_at)}</span>
              </div>
              <div style={{ color: C.sub, fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{m.body}</div>
              {m.error && <div style={{ color: C.red, fontSize: 11, marginTop: 5 }}>⚠️ {m.error}</div>}
            </div>
          ))}
        </div>
      )}

      {edit && <TemplateForm tpl={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </div>
  )
}

function TemplateForm({ tpl, onClose, onSaved }: { tpl: MessageTemplate; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState(tpl.body)
  const [active, setActive] = useState(tpl.active)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!body.trim()) { setErr('A mensagem não pode ficar vazia.'); return }
    setBusy(true); setErr('')
    const { error } = await sb.from('saas_message_templates').update({ body, active }).eq('id', tpl.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }

  return (
    <Modal title={TPL_LABEL[tpl.key] ?? tpl.key} onClose={onClose}>
      <Field label="Mensagem" hint="Variáveis: {{cliente}} {{app}} {{valor}} {{vencimento}} {{dias}} {{plano}} {{link}}">
        <textarea
          style={{ ...inp, minHeight: 190, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          value={body}
          onChange={e => setBody(e.target.value)}
        />
      </Field>
      <Toggle label="Modelo ativo" checked={active} onChange={setActive} />
      {err && <div style={{ color: C.red, fontSize: 13, marginTop: 10 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button style={{ ...btnGhost, flex: 1 }} onClick={onClose}>Cancelar</button>
        <button style={{ ...btn, flex: 1 }} disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}
