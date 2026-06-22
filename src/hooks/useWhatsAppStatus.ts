import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Estado real da instância WhatsApp (Evolution API):
//  - 'open'       → conectada ao celular (🟢)
//  - 'connecting' → pareando / reconectando (🟡)
//  - 'close'      → configurada mas desconectada (🔴)
//  - 'off'        → integração desativada/não configurada (cinza)
export type WAStatus = 'open' | 'connecting' | 'close' | 'off' | 'loading'

export function useWhatsAppStatus(houseId?: string): WAStatus {
  const [status, setStatus] = useState<WAStatus>('loading')

  useEffect(() => {
    if (!houseId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>

    async function check() {
      const { data: cfg } = await supabase
        .from('whatsapp_config')
        .select('active,api_url,instance_name,api_key')
        .eq('house_id', houseId).limit(1).maybeSingle()
      if (!alive) return
      if (!cfg?.active || !cfg.api_url || !cfg.instance_name || !cfg.api_key) {
        setStatus('off'); schedule(); return
      }
      try {
        const r = await fetch(`${cfg.api_url}/instance/connectionState/${cfg.instance_name}`, {
          headers: { apikey: cfg.api_key },
        })
        const j = await r.json()
        const state = j?.instance?.state ?? j?.state
        if (!alive) return
        setStatus(state === 'open' ? 'open' : state === 'connecting' ? 'connecting' : 'close')
      } catch {
        if (alive) setStatus('close')
      }
      schedule()
    }
    function schedule() { timer = setTimeout(check, 45000) }

    check()
    return () => { alive = false; clearTimeout(timer) }
  }, [houseId])

  return status
}
