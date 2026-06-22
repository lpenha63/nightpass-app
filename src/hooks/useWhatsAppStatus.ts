import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Estado real da instância WhatsApp (Evolution API):
//  - 'open'       → conectada ao celular (🟢)
//  - 'connecting' → pareando / reconectando (🟡)
//  - 'close'      → configurada mas desconectada (🔴)
//  - 'off'        → integração desativada/não configurada (cinza)
export type WAStatus = 'open' | 'connecting' | 'close' | 'off' | 'loading'

export function useWhatsAppStatus(houseId?: string) {
  const [status, setStatus] = useState<WAStatus>('loading')
  const [reconnecting, setReconnecting] = useState(false)

  const getCfg = useCallback(async () => {
    if (!houseId) return null
    const { data } = await supabase
      .from('whatsapp_config')
      .select('active,api_url,instance_name,api_key')
      .eq('house_id', houseId).limit(1).maybeSingle()
    return data
  }, [houseId])

  const check = useCallback(async () => {
    const cfg = await getCfg()
    if (!cfg?.active || !cfg.api_url || !cfg.instance_name || !cfg.api_key) { setStatus('off'); return }
    try {
      const r = await fetch(`${cfg.api_url}/instance/connectionState/${cfg.instance_name}`, { headers: { apikey: cfg.api_key } })
      const j = await r.json()
      const state = j?.instance?.state ?? j?.state
      // Binário: só 'open' conta como conectado. 'connecting' (sem aparelho pareado)
      // = desconectado na prática. O amarelo só aparece durante uma reconexão ativa.
      setStatus(state === 'open' ? 'open' : 'close')
    } catch {
      setStatus('close')
    }
  }, [getCfg])

  // Dispara a reconexão (Evolution: instance/connect) e revalida o estado
  const reconnect = useCallback(async () => {
    const cfg = await getCfg()
    if (!cfg?.api_url || !cfg.instance_name || !cfg.api_key) return
    setReconnecting(true); setStatus('connecting')
    try { await fetch(`${cfg.api_url}/instance/connect/${cfg.instance_name}`, { headers: { apikey: cfg.api_key } }) } catch { /* ignora */ }
    await new Promise(r => setTimeout(r, 2500))
    await check()
    setReconnecting(false)
  }, [getCfg, check])

  useEffect(() => {
    if (!houseId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const loop = async () => { if (!alive) return; await check(); if (alive) timer = setTimeout(loop, 45000) }
    loop()
    return () => { alive = false; clearTimeout(timer) }
  }, [houseId, check])

  return { status, reconnect, reconnecting, refresh: check }
}
