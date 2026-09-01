import { useState, useEffect, useCallback, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal } from '../components/ui'
import { cn, fcpf, ftel, fd, fmtCurrency, loyalTier } from '../utils/format'
import { sT, _err, type ToastState } from '../utils/toast'
import { sendWADirect } from '../utils/whatsapp'
import { QuickWA, type QuickWATarget } from '../components/QuickWA'
import type { House, Client } from '../types'
import { NASCIMENTO } from '../utils/limitesDeData'

interface Props { house: House; user: { id: string; email: string }; role: string }

const EMPTY_FORM = { full_name: '', cpf: '', phone: '', birth_date: '', email: '', photo_url: '', fingerprint_id: '', gender: '' }

// ── Helpers de importação por planilha ──────────────────────────────────────
const stripAccents = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
function normHeader(h: string): string { return stripAccents(String(h).toLowerCase()).replace(/[^a-z0-9]/g, '') }
function parseImportBirth(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) { let y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y; return `${y.padStart(4, '0')}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}
function normGender(v: string): string | null {
  const s = stripAccents(String(v).toLowerCase()).trim()
  if (!s) return null
  if (s.startsWith('f') || s === 'mulher') return 'feminino'
  if (s.startsWith('m') || s.startsWith('h')) return 'masculino'
  return null
}
interface ImportRow { full_name: string; cpf: string | null; phone: string; birth_date: string | null; email: string | null; gender: string | null; house_id: string; status: string; created_by: string }

// ── Birthday types ─────────────────────────────────────────────────────────
interface ClientWithDays extends Client { daysUntil: number; _mmdd?: string; birthday_wish_sent_at?: string | null }

// Conjunto de "MM-DD" cobertos por um intervalo (para aniversários, ignora o ano)
function bdMmddSet(start: string, end: string): Set<string> {
  const set = new Set<string>()
  if (!start || !end) return set
  const s = new Date(start + 'T12:00'), e = new Date(end + 'T12:00')
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return set
  let cur = new Date(s), guard = 0
  while (cur <= e && guard < 370) {
    set.add(`${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`)
    cur = new Date(cur.getTime() + 86400000); guard++
  }
  return set
}

// ── Clients tab ─────────────────────────────────────────────────────────────
export function ClientsPage({ house, user }: Props) {
  const [tab, setTab] = useState<'clientes' | 'aniversarios'>('clientes')
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState<Client | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [ldg, setLdg] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [ciCounts, setCiCounts] = useState<Record<string, number>>({})
  const [histClient, setHistClient] = useState<Client | null>(null)
  const [histData, setHistData] = useState<unknown[]>([])

  // Birthday state
  const [bdClients, setBdClients] = useState<ClientWithDays[]>([])
  const [bdDays, setBdDays] = useState('30')
  const [bdFilter, setBdFilter] = useState<'all' | 'week' | 'month'>('all')
  const [bdStart, setBdStart] = useState('')
  const [bdEnd, setBdEnd] = useState('')
  const [bdLoading, setBdLoading] = useState(false)
  const [sendingAll, setSendingAll] = useState(false)
  const [bdSettings, setBdSettings] = useState(false)
  const [bdMsgTemplate, setBdMsgTemplate] = useState('🎂 Feliz Aniversário, {nome}! 🎉\n\nQue seu dia seja repleto de alegria e celebração! 🥳\n\nCom carinho, {casa}')
  const [bdAutoSend, setBdAutoSend] = useState(false)
  const [bdImageUrl, setBdImageUrl] = useState('')
  const [bdUploadingImg, setBdUploadingImg] = useState(false)
  const [bdSavingCfg, setBdSavingCfg] = useState(false)

  // Filtros
  const [genderFilter, setGenderFilter] = useState<'all' | 'masculino' | 'feminino'>('all')
  // Filtro por gênero musical — derivado dos check-ins do cliente em eventos daquele gênero
  const [musicGenre, setMusicGenre] = useState<string>('all')
  const [availableGenres, setAvailableGenres] = useState<string[]>([])
  // Ordenar por maior frequência (nº de check-ins) na casa
  const [freqSort, setFreqSort] = useState(false)

  // Mass WhatsApp state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bdSelected, setBdSelected] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')
  const [bulkEventId, setBulkEventId] = useState('')
  const [events, setEvents] = useState<Array<{ id: string; name: string; event_date: string; flyer_url?: string }>>([])
  const [sendingBulk, setSendingBulk] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [bulkImageUrl, setBulkImageUrl] = useState('')
  const [uploadingBulkImg, setUploadingBulkImg] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ sent: number; total: number } | null>(null)
  const [quickWA, setQuickWA] = useState<QuickWATarget | null>(null)

  // Importação por planilha
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importName, setImportName] = useState('')
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [importStats, setImportStats] = useState<{ total: number; ready: number; dup: number; noPhone: number } | null>(null)
  const [importDone, setImportDone] = useState<{ inserted: number; failed: number } | null>(null)

  function openImport() { setImportOpen(true); setImportName(''); setImportRows([]); setImportStats(null); setImportDone(null) }

  const [exporting, setExporting] = useState(false)
  // Exporta a lista de clientes (respeitando busca/gênero/gênero musical), em XLSX ou CSV
  async function exportClients(fmt: 'xlsx' | 'csv') {
    setExporting(true)
    try {
      // Mesmos filtros da lista, mas sem paginação (limite alto) — via RPC no servidor
      const { data, error } = await supabase.rpc('filter_clients', {
        p_house: house.id,
        p_search: debouncedSearch || null,
        p_gender: genderFilter !== 'all' ? genderFilter : null,
        p_genre: musicGenre !== 'all' ? musicGenre : null,
        p_sort: freqSort ? 'visits' : 'name',
        p_limit: 100000,
        p_offset: 0,
      })
      if (error) { sT(setToast, 'Erro ao exportar: ' + error.message, 'error'); return }
      if (!data || data.length === 0) { sT(setToast, 'Nenhum cliente para exportar', 'warn'); return }
      const rows = (data as Array<{ full_name?: string; cpf?: string; phone?: string; email?: string; gender?: string; birth_date?: string; status?: string; created_at?: string; visits?: number }>).map(c => ({
        Nome: c.full_name ?? '',
        CPF: c.cpf ? fcpf(c.cpf) : '',
        Telefone: c.phone ? ftel(c.phone) : '',
        Email: c.email ?? '',
        Genero: c.gender ?? '',
        Nascimento: c.birth_date ? fd(c.birth_date) : '',
        Status: c.status ?? '',
        Cadastro: c.created_at ? fd(c.created_at.slice(0, 10)) : '',
        Visitas: Number(c.visits ?? 0),
      }))
      const XLSX = await import('xlsx')
      const ws = XLSX.utils.json_to_sheet(rows)
      const stamp = new Date().toISOString().slice(0, 10)
      if (fmt === 'csv') {
        const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' })
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `clientes-${stamp}.csv`; a.click(); URL.revokeObjectURL(url)
      } else {
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
        XLSX.writeFile(wb, `clientes-${stamp}.xlsx`)
      }
      sT(setToast, `✅ ${rows.length} cliente(s) exportado(s)!`, 'success')
    } finally {
      setExporting(false)
    }
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportName(file.name); setImporting(true); setImportStats(null); setImportRows([]); setImportDone(null)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      const { data: existing } = await supabase.from('clients').select('cpf,phone').eq('house_id', house.id)
      const exCpf = new Set<string>(); const exPhone = new Set<string>()
      ;(existing ?? []).forEach(c => { const cp = cn(c.cpf ?? ''); if (cp) exCpf.add(cp); const ph = cn(c.phone ?? ''); if (ph) exPhone.add(ph) })
      const seenCpf = new Set<string>(); const seenPhone = new Set<string>()
      const ready: ImportRow[] = []
      let dup = 0, noPhone = 0
      for (const r of raw) {
        const keyMap: Record<string, string> = {}
        for (const k of Object.keys(r)) keyMap[normHeader(k)] = k
        const cell = (...ks: string[]): unknown => { for (const k of ks) { if (keyMap[k] != null) return r[keyMap[k]] } return '' }
        const str = (...ks: string[]) => String(cell(...ks) ?? '').trim()
        const name = str('nome', 'nomecompleto', 'name', 'cliente', 'razaosocial')
        const cpf = cn(str('cpf', 'documento', 'doc'))
        const phone = cn(str('telefone', 'celular', 'phone', 'tel', 'whatsapp', 'fone', 'contato'))
        const birth = parseImportBirth(cell('nascimento', 'datadenascimento', 'datanascimento', 'aniversario', 'nasc', 'birthdate', 'dtnasc'))
        const email = str('email', 'e-mail', 'mail') || null
        const gender = normGender(str('genero', 'sexo', 'gender'))
        if (phone.length < 10) { noPhone++; continue }
        if ((cpf && (exCpf.has(cpf) || seenCpf.has(cpf))) || exPhone.has(phone) || seenPhone.has(phone)) { dup++; continue }
        if (cpf) seenCpf.add(cpf)
        seenPhone.add(phone)
        ready.push({ full_name: name || `Cliente ${phone}`, cpf: cpf || null, phone, birth_date: birth, email, gender, house_id: house.id, status: 'active', created_by: user.id })
      }
      setImportStats({ total: raw.length, ready: ready.length, dup, noPhone })
      setImportRows(ready)
    } catch (err) {
      sT(setToast, 'Erro ao ler a planilha: ' + ((err as Error)?.message ?? 'formato inválido'), 'error')
    } finally {
      setImporting(false)
    }
  }

  async function doImport() {
    if (importRows.length === 0) return
    setImporting(true)
    let inserted = 0, failed = 0
    for (let i = 0; i < importRows.length; i += 200) {
      const batch = importRows.slice(i, i + 200)
      const { error, data } = await supabase.from('clients').insert(batch).select('id')
      if (!error) { inserted += data?.length ?? batch.length; continue }
      for (const row of batch) {
        const { error: e1 } = await supabase.from('clients').insert(row)
        if (e1) failed++; else inserted++
      }
    }
    setImporting(false)
    setImportDone({ inserted, failed })
    setImportRows([])
    load()
  }

  const load = useCallback(() => {
    if (!house) return
    // Tudo no servidor (RPC): filtra por busca/sexo/gênero-musical, ordena por nome ou frequência,
    // pagina e devolve o total + nº de visitas — sem passar listas gigantes de ids na URL.
    supabase.rpc('filter_clients', {
      p_house: house.id,
      p_search: debouncedSearch || null,
      p_gender: genderFilter !== 'all' ? genderFilter : null,
      p_genre: musicGenre !== 'all' ? musicGenre : null,
      p_sort: freqSort ? 'visits' : 'name',
      p_limit: 30,
      p_offset: page * 30,
    }).then(r => {
      setLdg(false)
      const rows = (r.data ?? []) as Array<Client & { visits?: number; total_count?: number }>
      setTotal(rows[0]?.total_count ?? 0)
      setClients(rows)
      const m: Record<string, number> = {}
      rows.forEach(row => { m[row.id] = Number(row.visits ?? 0) })
      setCiCounts(m)
    })
  }, [house, debouncedSearch, page, genderFilter, musicGenre, freqSort])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [debouncedSearch, genderFilter, musicGenre, freqSort])

  // Debounce: aplica a busca 400ms após o usuário parar de digitar
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  // Carrega a lista de gêneros musicais distintos a partir dos eventos da casa
  useEffect(() => {
    supabase.from('events').select('genre').eq('house_id', house.id).not('genre', 'is', null)
      .then(r => {
        const set = new Set<string>()
        ;(r.data ?? []).forEach(e => { if (e.genre && e.genre.trim()) set.add(e.genre.trim()) })
        setAvailableGenres([...set].sort())
      })
  }, [house.id])

  // Carrega config de aniversário (mensagem + flyer/cupom) persistida na casa
  useEffect(() => {
    supabase.from('houses').select('birthday_msg,birthday_image_url').eq('id', house.id).maybeSingle()
      .then(r => {
        if (r.data?.birthday_msg) setBdMsgTemplate(r.data.birthday_msg)
        setBdImageUrl(r.data?.birthday_image_url ?? '')
      })
  }, [house.id])

  // Load upcoming events for the bulk invite picker
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    supabase.from('events').select('id,name,event_date,flyer_url').eq('house_id', house.id)
      .gte('event_date', today).order('event_date')
      .then(r => setEvents((r.data ?? []) as typeof events))
  }, [house.id])

  // Load birthdays when tab changes or days filter changes
  useEffect(() => {
    if (tab !== 'aniversarios') return
    setBdLoading(true)
    // Carrega TODOS os aniversariantes da base; o recorte (período/semana/mês) é aplicado em filteredBd.
    supabase.from('clients').select('*').eq('house_id', house.id).not('birth_date', 'is', null)
      .then(r => {
        // meia-noite de hoje: aniversário de HOJE conta como faltando 0 dias (não joga para o ano que vem)
        const now = new Date(); now.setHours(0, 0, 0, 0)
        const withDays = (r.data ?? []).map(c => {
          const bd = new Date((c.birth_date ?? '') + 'T00:00:00')
          let ty = new Date(now.getFullYear(), bd.getMonth(), bd.getDate())
          if (ty < now) ty = new Date(now.getFullYear() + 1, bd.getMonth(), bd.getDate())
          const diff = Math.round((ty.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          const mmdd = `${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`
          return { ...c, daysUntil: diff, _mmdd: mmdd }
        }).sort((a, b) => a.daysUntil - b.daysUntil)
        setBdClients(withDays)
        setBdLoading(false)
      })
  }, [tab, house.id])

  function openHistory(c: Client) {
    setHistClient(c)
    supabase.from('checkins').select('created_at,amount_cents,payment_method,events(name)')
      .eq('house_id', house.id).eq('client_id', c.id).order('created_at', { ascending: false }).limit(20)
      .then(r => setHistData(r.data ?? []))
  }

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setModal(true) }
  function openEdit(c: Client) { setEditing(c); setForm({ full_name: c.full_name, cpf: c.cpf ?? '', phone: c.phone ?? '', birth_date: c.birth_date ?? '', email: c.email ?? '', photo_url: c.photo_url ?? '', fingerprint_id: c.fingerprint_id ?? '', gender: c.gender ?? '' }); setModal(true) }

  function save() {
    if (!form.full_name.trim()) { sT(setToast, 'Nome obrigatório', 'error'); return }
    if (cn(form.phone).length < 10) { sT(setToast, 'Celular obrigatório', 'error'); return }
    if (!form.birth_date) { sT(setToast, 'Data de nascimento obrigatória', 'error'); return }
    const data = { full_name: form.full_name, cpf: cn(form.cpf) || null, phone: cn(form.phone), birth_date: form.birth_date || null, gender: form.gender || null, email: form.email || null, photo_url: form.photo_url || null, fingerprint_id: form.fingerprint_id || null, house_id: house.id, status: 'active', created_by: user.id }
    const q = editing ? supabase.from('clients').update(data).eq('id', editing.id) : supabase.from('clients').insert(data)
    q.then(r => {
      if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
      sT(setToast, editing ? '✅ Cliente atualizado!' : '✅ Cliente cadastrado!', 'success')
      setModal(false); load()
    })
  }

  async function uploadPhoto(file: File) {
    setUploadingPhoto(true)
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${house.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('client-photos').upload(path, file, { upsert: true })
    if (error) { sT(setToast, 'Erro no upload: ' + error.message, 'error'); setUploadingPhoto(false); return }
    const { data } = supabase.storage.from('client-photos').getPublicUrl(path)
    setForm(p => ({ ...p, photo_url: data.publicUrl }))
    setUploadingPhoto(false)
    sT(setToast, '📸 Foto enviada!', 'success')
  }

  // Upload do flyer/cupom de aniversário (enviado junto com a mensagem)
  async function uploadBdImage(file: File) {
    setBdUploadingImg(true)
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${house.id}/birthday-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('event-flyers').upload(path, file, { upsert: true })
    if (error) { sT(setToast, 'Erro no upload: ' + error.message, 'error'); setBdUploadingImg(false); return }
    const { data } = supabase.storage.from('event-flyers').getPublicUrl(path)
    setBdImageUrl(data.publicUrl)
    setBdUploadingImg(false)
    sT(setToast, '🖼️ Imagem enviada!', 'success')
  }

  async function saveBdConfig() {
    setBdSavingCfg(true)
    const { error } = await supabase.from('houses').update({
      birthday_msg: bdMsgTemplate,
      birthday_image_url: bdImageUrl || null,
    }).eq('id', house.id)
    setBdSavingCfg(false)
    if (error) { sT(setToast, 'Erro ao salvar: ' + error.message, 'error'); return }
    sT(setToast, '✅ Configurações salvas!', 'success')
    setBdSettings(false)
  }

  function del(c: Client) {
    if (!confirm(`Remover ${c.full_name}?`)) return
    supabase.from('clients').delete().eq('id', c.id).then(r => {
      if (r.error) { _err(r.error.message); return }
      sT(setToast, 'Cliente removido', 'success'); load()
    })
  }

  // Já recebeu mensagem de aniversário neste ano? (evita reenvio/spam)
  function wishSentThisYear(c: ClientWithDays): boolean {
    if (!c.birthday_wish_sent_at) return false
    return new Date(c.birthday_wish_sent_at).getFullYear() === new Date().getFullYear()
  }

  // Marca no banco e no estado local que o cliente já recebeu a mensagem de aniversário
  async function markBdSent(id: string) {
    const ts = new Date().toISOString()
    await supabase.from('clients').update({ birthday_wish_sent_at: ts }).eq('id', id)
    setBdClients(prev => prev.map(c => c.id === id ? { ...c, birthday_wish_sent_at: ts } : c))
  }

  async function sendBdWA(c: ClientWithDays) {
    if (!c.phone) { sT(setToast, 'Sem telefone cadastrado', 'warn'); return }
    const nome = c.full_name.split(' ')[0]
    const msg = bdMsgTemplate
      .replace(/\{nome\}/g, nome)
      .replace(/\{casa\}/g, house.name || 'NightPass')
      .replace(/\{fullname\}/g, c.full_name)
    await sendWADirect(house.id, c.phone, msg, { clientId: c.id, type: 'birthday_wish', mediaUrl: bdImageUrl || undefined })
    await markBdSent(c.id)
  }

  function toggleBdSel(id: string) {
    setBdSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  // Seleciona/limpa todos os que ainda NÃO receberam e têm telefone
  function toggleBdSelAll() {
    const eligible = filteredBd.filter(c => c.phone && !wishSentThisYear(c)).map(c => c.id)
    setBdSelected(prev => {
      const allSel = eligible.length > 0 && eligible.every(id => prev.has(id))
      const n = new Set(prev)
      eligible.forEach(id => allSel ? n.delete(id) : n.add(id))
      return n
    })
  }

  // Envia apenas para os selecionados (evita disparo em massa que parece spam)
  async function sendSelectedBdWA() {
    const recipients = filteredBd.filter(c => bdSelected.has(c.id) && c.phone && !wishSentThisYear(c))
    if (recipients.length === 0) { sT(setToast, 'Selecione ao menos 1 aniversariante com telefone (ainda não enviado)', 'warn'); return }
    // Checa a conexão antes (se a API estiver ativa) — senão o envio abriria N abas do WhatsApp Web
    const { data: cfg } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
    if (cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key) {
      const { waConnectionState, waStateMessage } = await import('../utils/whatsapp')
      const st = await waConnectionState(cfg)
      if (st !== 'open') { sT(setToast, '❌ ' + waStateMessage(st), 'error'); return }
    }
    if (!confirm(`Enviar mensagem de aniversário para ${recipients.length} selecionado(s)?`)) return
    setSendingAll(true)
    let ok = 0
    for (const c of recipients) {
      await sendBdWA(c)
      ok++
      setBdSelected(prev => { const n = new Set(prev); n.delete(c.id); return n })
      await new Promise(r => setTimeout(r, 800))
    }
    setSendingAll(false)
    sT(setToast, `✅ ${ok} mensagem(ns) enviada(s)!`, 'success')
  }

  function toggleSel(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleSelAll() {
    setSelected(prev => {
      const pageIds = clients.map(c => c.id)
      const allSel = pageIds.every(id => prev.has(id))
      const n = new Set(prev)
      pageIds.forEach(id => allSel ? n.delete(id) : n.add(id))
      return n
    })
  }

  function openBulk() {
    if (selected.size === 0) { sT(setToast, 'Selecione ao menos 1 cliente', 'warn'); return }
    setBulkMsg(''); setBulkEventId(''); setBulkImageUrl(''); setBulkProgress(null); setBulkModal(true)
  }

  function loadBulkImage(file: File) {
    setUploadingBulkImg(true)
    const reader = new FileReader()
    reader.onload = e => {
      const result = e.target?.result as string
      if (result) setBulkImageUrl(result) // data:image/...;base64,...
      setUploadingBulkImg(false)
    }
    reader.onerror = () => {
      sT(setToast, 'Erro ao ler imagem', 'error')
      setUploadingBulkImg(false)
    }
    reader.readAsDataURL(file)
  }

  function applyEventTemplate(eventId: string) {
    setBulkEventId(eventId)
    const ev = events.find(e => e.id === eventId)
    if (!ev) return
    const dataFmt = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    const link = `${window.location.origin}/e/${ev.id}`
    setBulkMsg(`Olá {nome}! 🎉\n\nVocê está convidado(a) para *${ev.name}* 🎶\n📅 ${dataFmt}\n\n🎫 Garanta sua presença: ${link}\n\nTe esperamos! — ${house.name || 'NightPass'}`)
  }

  async function sendBulkWA() {
    if (!bulkMsg.trim()) { sT(setToast, 'Escreva uma mensagem', 'warn'); return }
    const ids = [...selected]
    const { data } = await supabase.from('clients').select('id,full_name,phone').in('id', ids).not('phone', 'is', null)
    const recipients = (data ?? []).filter(c => c.phone)
    if (recipients.length === 0) { sT(setToast, 'Nenhum selecionado com telefone', 'warn'); return }

    // Try Evolution API first (supports images + text)
    const { data: cfg } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
    const useEvolution = !!(cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key)

    if (!useEvolution && bulkImageUrl) {
      sT(setToast, 'Configure o WhatsApp em Configurações para enviar imagens.', 'warn'); return
    }
    // Checa a conexão ANTES de disparar — evita "0 enviadas" silencioso quando o servidor/instância está fora
    if (useEvolution) {
      const { waConnectionState, waStateMessage } = await import('../utils/whatsapp')
      const st = await waConnectionState(cfg)
      if (st !== 'open') { sT(setToast, '❌ ' + waStateMessage(st), 'error'); return }
    }
    if (!confirm(`Disparar para ${recipients.length} cliente(s)?`)) return

    setSendingBulk(true)
    setBulkProgress({ sent: 0, total: recipients.length })
    let ok = 0, fail = 0

    for (const c of recipients) {
      const { fmtWAPhone } = await import('../utils/whatsapp')
      const fph = fmtWAPhone(c.phone ?? '')
      const nome = (c.full_name || '').split(' ')[0]
      const msg = bulkMsg.replace(/\{nome\}/g, nome)

      if (useEvolution && fph) {
        try {
          const useMedia = !!bulkImageUrl
          // Evolution API aceita base64 puro (sem prefixo data:...)
          const mediaBase64 = bulkImageUrl.includes(',') ? bulkImageUrl.split(',')[1] : bulkImageUrl
          const body = useMedia
            ? { number: fph, mediatype: 'image', media: mediaBase64, caption: msg }
            : { number: fph, text: msg, linkPreview: true }
          const resp = await fetch(`${cfg.api_url}/message/${useMedia ? 'sendMedia' : 'sendText'}/${cfg.instance_name}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.api_key }, body: JSON.stringify(body),
          })
          const res = await resp.json()
          const sent = !!(res?.key || res?.status === 'success' || res?.status === 'PENDING')
          if (sent) ok++; else fail++
          await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: c.full_name, message_type: 'bulk', message_body: msg, status: sent ? 'sent' : 'failed', error_msg: sent ? null : JSON.stringify(res), related_client_id: c.id })
        } catch (e: any) {
          fail++
          await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: c.full_name, message_type: 'bulk', message_body: msg, status: 'failed', error_msg: e?.message ?? 'erro', related_client_id: c.id })
        }
        await new Promise(r => setTimeout(r, 500))
      } else {
        window.open(`https://wa.me/55${cn(c.phone ?? '')}?text=${encodeURIComponent(msg)}`, '_blank')
        ok++
        await new Promise(r => setTimeout(r, 800))
      }
      setBulkProgress(p => p ? ({ ...p, sent: p.sent + 1 }) : p)
    }

    setSendingBulk(false); setBulkProgress(null)
    if (ok === 0 && fail > 0) {
      sT(setToast, `❌ Nenhuma enviada (${fail} falha${fail !== 1 ? 's' : ''}). WhatsApp pode ter desconectado — verifique em Configurações.`, 'error')
      return
    }
    setBulkModal(false); setSelected(new Set())
    sT(setToast, `✅ ${ok} enviada${ok !== 1 ? 's' : ''}${fail > 0 ? ` · ${fail} falha${fail !== 1 ? 's' : ''}` : ''}!`, fail > 0 ? 'warn' : 'success')
  }

  const now = new Date()
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay())
  const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6)

  const filteredBd = bdClients.filter(c => {
    // Período personalizado tem prioridade
    if (bdDays === 'custom') {
      const set = bdMmddSet(bdStart, bdEnd)
      return !!c._mmdd && set.has(c._mmdd)
    }
    // Botões Semana/Mês recortam o ANO inteiro (não a janela de "próximos N dias")
    if (bdFilter === 'week') {
      const bd = new Date((c.birth_date ?? '') + 'T00:00:00')
      const ty = new Date(now.getFullYear(), bd.getMonth(), bd.getDate())
      return ty >= startOfWeek && ty <= endOfWeek
    }
    if (bdFilter === 'month') {
      const bd = new Date((c.birth_date ?? '') + 'T00:00:00')
      return bd.getMonth() === now.getMonth()
    }
    // "Todos" → usa a janela do dropdown (próximos N dias)
    return c.daysUntil <= parseInt(bdDays)
  })

  const dayLabel = (d: number) => d === 0 ? '🎂 Hoje!' : d === 1 ? '🎈 Amanhã' : `Em ${d} dias`
  const dayColor = (d: number) => d === 0 ? C.red : d <= 3 ? C.gold : C.mut

  const inp = (style?: React.CSSProperties) => ({ style: { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit', boxSizing: 'border-box' as const, ...style } })

  return (
    <div style={{ paddingBottom: 80 }}>
      <Toast toast={toast} />
      <QuickWA houseId={house.id} target={quickWA} onClose={() => setQuickWA(null)} onSent={via => sT(setToast, via ? '✅ Mensagem enviada pela API' : '📲 Abrindo WhatsApp...', 'success')} />

      {/* History Modal */}
      {histClient && (
        <Modal open title={`Histórico — ${histClient.full_name}`} onClose={() => setHistClient(null)} wide>
          {histData.length === 0
            ? <div style={{ color: C.mut, fontSize: 14 }}>Nenhum check-in registrado</div>
            : (histData as Array<{ created_at: string; amount_cents: number; payment_method: string; events?: { name: string } }>).map((ci, i) => {
                const dt = new Date(ci.created_at)
                const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
                    <div>
                      <div style={{ color: C.txt, fontSize: 13 }}>{ci.events?.name ?? 'Entrada livre'}</div>
                      <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>🕐 {fd(ci.created_at.slice(0, 10))} às {timeStr}</div>
                    </div>
                    <span style={{ color: C.mut, fontSize: 12, flexShrink: 0, marginLeft: 8 }}>{fmtCurrency(ci.amount_cents)}</span>
                  </div>
                )
              })
          }
        </Modal>
      )}

      {/* New/Edit Modal */}
      <Modal open={modal} title={editing ? 'Editar Cliente' : 'Novo Cliente'} onClose={() => setModal(false)}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: C.brd, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
              {form.photo_url
                ? <img loading="lazy" decoding="async" src={form.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                : '👤'}
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Foto (opcional)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer', fontSize: 13, color: C.mut, minHeight: 44, boxSizing: 'border-box' }}>
                  {uploadingPhoto ? '⏳ Enviando...' : (form.photo_url ? '🔄 Trocar foto' : '📷 Tirar / enviar foto')}
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={uploadingPhoto}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />
                </label>
                {form.photo_url && (
                  <button onClick={() => setForm(p => ({ ...p, photo_url: '' }))} style={{ background: C.red + '18', border: `1px solid ${C.red}44`, borderRadius: 8, color: C.red, cursor: 'pointer', padding: '0 12px', fontSize: 13 }}>✕</button>
                )}
              </div>
            </div>
          </div>
          <div><label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>Nome Completo *</label>
            <input {...inp()} value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder="Nome completo" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>CPF</label>
              <input {...inp()} value={fcpf(form.cpf)} onChange={e => setForm(p => ({ ...p, cpf: cn(e.target.value).slice(0, 11) }))} placeholder="000.000.000-00" /></div>
            <div><label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>Celular *</label>
              <input {...inp()} value={ftel(form.phone)} onChange={e => setForm(p => ({ ...p, phone: cn(e.target.value).slice(0, 11) }))} placeholder="(00) 00000-0000" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>Nascimento *</label>
              <input type="date" min={NASCIMENTO.min} max={NASCIMENTO.max} {...inp()} value={form.birth_date} onChange={e => setForm(p => ({ ...p, birth_date: e.target.value }))} /></div>
            <div><label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>E-mail (opcional)</label>
              <input {...inp()} type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@exemplo.com" /></div>
          </div>
          <div><label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>Gênero</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['masculino', '♂ Masculino', C.acc], ['feminino', '♀ Feminino', '#f472b6']] as const).map(([g, label, col]) => {
                const on = form.gender === g
                return (
                  <button key={g} type="button" onClick={() => setForm(p => ({ ...p, gender: on ? '' : g }))}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `2px solid ${on ? col : C.brd}`, background: on ? col + '22' : 'transparent', color: on ? col : C.mut, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div><label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>🔒 ID Biométrico / Digital (opcional)</label>
            <input {...inp()} value={form.fingerprint_id} onChange={e => setForm(p => ({ ...p, fingerprint_id: e.target.value }))} placeholder="Código do leitor de digital (preenchido pela portaria)" />
            <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>O leitor físico grava o código aqui. A captura direta pelo leitor depende de integração com o aparelho.</div></div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Btn onClick={save} style={{ flex: 1 }}>💾 Salvar</Btn>
            <Btn onClick={() => setModal(false)} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* Bulk WhatsApp Modal */}
      <Modal open={bulkModal} title={`📲 Disparo em massa — ${selected.size} cliente(s)`} onClose={() => setBulkModal(false)}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Convidar para um evento (opcional)</label>
            <select {...inp()} value={bulkEventId} onChange={e => applyEventTemplate(e.target.value)}>
              <option value="">— Mensagem livre —</option>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name} · {fd(ev.event_date)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Mensagem</label>
            <textarea {...inp({ minHeight: 130, height: 130, resize: 'vertical' as const })} value={bulkMsg} onChange={e => setBulkMsg(e.target.value)} placeholder="Escreva a mensagem... Use {nome} para inserir o primeiro nome de cada cliente." />
            <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>💡 <code>{'{nome}'}</code> é substituído pelo primeiro nome de cada destinatário.</div>
          </div>

          {/* Image upload */}
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>🖼️ Imagem (opcional)</label>
            {bulkImageUrl ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img loading="lazy" decoding="async" src={bulkImageUrl} alt="preview" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.brd}`, display: 'block' }} />
                <button onClick={() => setBulkImageUrl('')}
                  style={{ position: 'absolute', top: 6, right: 6, background: '#0009', border: 'none', borderRadius: '50%', width: 28, height: 28, color: '#fff', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ✕
                </button>
              </div>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.card, border: `1px dashed ${C.brd}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}>
                <span style={{ fontSize: 22 }}>{uploadingBulkImg ? '⏳' : '📎'}</span>
                <span style={{ color: C.mut, fontSize: 13 }}>{uploadingBulkImg ? 'Enviando...' : 'Clique para carregar imagem (JPG, PNG, GIF)'}</span>
                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploadingBulkImg}
                  onChange={e => { const f = e.target.files?.[0]; if (f) loadBulkImage(f); e.target.value = '' }} />
              </label>
            )}
            {bulkImageUrl && <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>✅ Imagem carregada — será enviada junto com a mensagem via WhatsApp API.</div>}
          </div>

          {/* Progress */}
          {bulkProgress && (
            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: C.mut }}>
                <span>Enviando...</span><span>{bulkProgress.sent}/{bulkProgress.total}</span>
              </div>
              <div style={{ background: C.brd, borderRadius: 4, height: 6 }}>
                <div style={{ background: '#25D366', borderRadius: 4, height: 6, width: `${(bulkProgress.sent / bulkProgress.total) * 100}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {(() => {
            const recip = clients.filter(c => selected.has(c.id) && c.phone).length
            const noPhone = selected.size - clients.filter(c => selected.has(c.id) && c.phone).length
            return (
              <div style={{ fontSize: 12, color: C.mut }}>
                {recip} com telefone nesta página{noPhone > 0 ? ` · ${noPhone} sem telefone (serão ignorados)` : ''}
              </div>
            )
          })()}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Btn onClick={sendBulkWA} disabled={sendingBulk || uploadingBulkImg} style={{ flex: 1, background: '#25D36622', color: '#25D366', border: '1px solid #25D36644' }}>
              {sendingBulk ? `⏳ ${bulkProgress ? `${bulkProgress.sent}/${bulkProgress.total}` : 'Enviando...'}` : '📲 Disparar agora'}
            </Btn>
            <Btn onClick={() => setBulkModal(false)} variant="ghost" disabled={sendingBulk}>Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* Modal Configurações de Aniversário */}
      <Modal open={bdSettings} title="⚙️ Configurações — Aniversários" onClose={() => setBdSettings(false)}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Mensagem padrão</label>
            <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>
              Variáveis: <code style={{ background: C.card, padding: '1px 5px', borderRadius: 4 }}>{'{nome}'}</code> (primeiro nome),{' '}
              <code style={{ background: C.card, padding: '1px 5px', borderRadius: 4 }}>{'{fullname}'}</code> (nome completo),{' '}
              <code style={{ background: C.card, padding: '1px 5px', borderRadius: 4 }}>{'{casa}'}</code> (nome da casa)
            </div>
            <textarea
              rows={6}
              value={bdMsgTemplate}
              onChange={e => setBdMsgTemplate(e.target.value)}
              style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
          {/* Flyer / cupom anexado */}
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🖼️ Flyer / Cupom (opcional)</label>
            <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>A imagem é enviada junto com a mensagem de aniversário (ex: cupom de cortesia, flyer do mês).</div>
            {bdImageUrl ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img loading="lazy" decoding="async" src={bdImageUrl} alt="Flyer de aniversário" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, border: `1px solid ${C.brd}`, display: 'block' }} />
                <button onClick={() => setBdImageUrl('')}
                  style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, cursor: 'pointer', padding: '4px 8px' }}>✕ Remover</button>
              </div>
            ) : (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px dashed ${C.brd}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer', color: C.sub, fontSize: 13, fontWeight: 600 }}>
                {bdUploadingImg ? '⏳ Enviando...' : '📎 Anexar imagem'}
                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={bdUploadingImg}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadBdImage(f) }} />
              </label>
            )}
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>Pré-visualização</label>
            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: C.txt, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {bdImageUrl && <img loading="lazy" decoding="async" src={bdImageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8, display: 'block' }} />}
              {bdMsgTemplate
                .replace(/\{nome\}/g, 'João')
                .replace(/\{fullname\}/g, 'João Silva')
                .replace(/\{casa\}/g, house.name || 'NightPass')}
            </div>
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={bdAutoSend} onChange={e => setBdAutoSend(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: C.acc, cursor: 'pointer' }} />
              <div>
                <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>Lembrete na tela (em breve)</div>
                <div style={{ fontSize: 11, color: C.mut }}>Notificar quando houver aniversariantes no dia</div>
              </div>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={saveBdConfig} disabled={bdSavingCfg} style={{ flex: 1 }}>{bdSavingCfg ? 'Salvando...' : '✅ Salvar configurações'}</Btn>
            <Btn onClick={() => setBdMsgTemplate('🎂 Feliz Aniversário, {nome}! 🎉\n\nQue seu dia seja repleto de alegria e celebração! 🥳\n\nCom carinho, {casa}')} variant="ghost">Restaurar padrão</Btn>
          </div>
        </div>
      </Modal>

      {/* Importar planilha */}
      <Modal open={importOpen} title="📥 Importar Clientes" onClose={() => { if (!importing) setImportOpen(false) }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
            Envie uma planilha <strong>.xlsx, .xls ou .csv</strong>. A 1ª linha é o cabeçalho.
            <div style={{ marginTop: 6, color: C.mut, fontSize: 12 }}>
              Colunas reconhecidas: <strong style={{ color: C.txt }}>Telefone</strong> (obrigatório) · Nome · CPF · Nascimento · Email · Gênero
            </div>
            <div style={{ marginTop: 4, color: C.mut, fontSize: 12 }}>
              Duplicados (mesmo <strong>CPF</strong>, ou mesmo <strong>telefone</strong>) são ignorados automaticamente.
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: C.bg, border: `1px dashed ${C.brd}`, borderRadius: 10, padding: '16px 14px', cursor: importing ? 'wait' : 'pointer', color: C.acc, fontSize: 14, fontWeight: 700 }}>
            📁 {importName || 'Selecionar planilha'}
            <input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" style={{ display: 'none' }} disabled={importing} onChange={handleImportFile} />
          </label>

          {importing && !importStats && <div style={{ color: C.mut, textAlign: 'center', fontSize: 13 }}>⏳ Lendo planilha…</div>}

          {importStats && (
            <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              {([['Linhas', importStats.total, C.mut], ['A importar', importStats.ready, C.grn], ['Duplicados', importStats.dup, C.gold], ['Sem telefone', importStats.noPhone, C.red]] as const).map(([lbl, val, col]) => (
                <div key={lbl} style={{ background: (col as string) + '14', border: `1px solid ${col}33`, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: col as string }}>{val}</div>
                  <div style={{ fontSize: 10, color: C.mut, fontWeight: 700, textTransform: 'uppercase' }}>{lbl}</div>
                </div>
              ))}
            </div>
          )}

          {importDone
            ? <div style={{ background: '#10b98111', border: '1px solid #10b98133', borderRadius: 10, padding: '12px 14px', color: C.grn, fontSize: 14, fontWeight: 700, textAlign: 'center' }}>
                ✅ {importDone.inserted} cliente(s) importado(s){importDone.failed > 0 ? ` · ${importDone.failed} falha(s)` : ''}
              </div>
            : importStats && importStats.ready > 0
              ? <Btn onClick={doImport} disabled={importing} style={{ width: '100%' }}>{importing ? '⏳ Importando…' : `✅ Importar ${importStats.ready} cliente(s)`}</Btn>
              : importStats
                ? <div style={{ color: C.gold, fontSize: 13, textAlign: 'center' }}>Nada novo para importar.</div>
                : null}
        </div>
      </Modal>

      {/* Header */}
      <div className="r-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, marginBottom: 4 }}>👥 Clientes</h1>
          <p style={{ color: C.mut, fontSize: 14 }}>{total.toLocaleString('pt-BR')} clientes cadastrados</p>
        </div>
        {tab === 'clientes' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Btn onClick={() => exportClients('xlsx')} disabled={exporting} variant="secondary" icon="📊">{exporting ? 'Exportando…' : 'Excel'}</Btn>
            <Btn onClick={() => exportClients('csv')} disabled={exporting} variant="secondary" icon="📄">CSV</Btn>
            <Btn onClick={openImport} variant="secondary" icon="📥">Importar</Btn>
            <Btn onClick={openNew} icon="➕">Novo Cliente</Btn>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {([['clientes', '👥 Clientes'], ['aniversarios', '🎂 Aniversários']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${tab === id ? C.acc : C.brd}`, background: tab === id ? C.acc + '22' : 'transparent', color: tab === id ? C.acc : C.mut, fontSize: 14, fontWeight: tab === id ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            {label}
            {id === 'aniversarios' && bdClients.length > 0 && (
              <span style={{ marginLeft: 8, background: C.gold, color: '#000', borderRadius: 8, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>{bdClients.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── CLIENTES TAB ── */}
      {tab === 'clientes' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome, CPF ou celular..."
              style={{ flex: 1, minWidth: 200, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }} />
            {/* Filtro por gênero */}
            <div style={{ display: 'flex', gap: 4 }}>
              {([['all', '👥 Todos'], ['masculino', '♂ Masc.'], ['feminino', '♀ Fem.']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setGenderFilter(id)}
                  style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${genderFilter === id ? C.acc : C.brd}`, background: genderFilter === id ? C.acc + '22' : 'transparent', color: genderFilter === id ? C.acc : C.mut, fontSize: 12, fontWeight: genderFilter === id ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}>
                  {label}
                </button>
              ))}
            </div>
            {/* Filtro por gênero musical (quem frequentou eventos do gênero) */}
            {availableGenres.length > 0 && (
              <select value={musicGenre} onChange={e => setMusicGenre(e.target.value)}
                title="Filtrar por quem frequentou eventos deste gênero musical"
                style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${musicGenre !== 'all' ? '#a78bfa' : C.brd}`, background: musicGenre !== 'all' ? '#a78bfa22' : C.card, color: musicGenre !== 'all' ? '#a78bfa' : C.mut, fontSize: 12, fontWeight: musicGenre !== 'all' ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}>
                <option value="all">🎵 Todo gênero musical</option>
                {availableGenres.map(g => <option key={g} value={g}>🎵 {g}</option>)}
              </select>
            )}
            {/* Ordenar por maior frequência na casa */}
            <button onClick={() => setFreqSort(v => !v)}
              title="Ordenar os clientes que mais frequentam a casa primeiro"
              style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${freqSort ? C.gold : C.brd}`, background: freqSort ? C.gold + '22' : C.card, color: freqSort ? C.gold : C.mut, fontSize: 12, fontWeight: freqSort ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}>
              ⭐ Mais frequentes
            </button>
          </div>
          {(musicGenre !== 'all' || freqSort) && (
            <div style={{ marginTop: -8, marginBottom: 12, fontSize: 12, color: freqSort ? C.gold : '#a78bfa' }}>
              {musicGenre !== 'all' && <>🎵 Clientes que já frequentaram eventos de <strong>{musicGenre}</strong></>}
              {musicGenre !== 'all' && freqSort && ' · '}
              {freqSort && <>⭐ Ordenado por <strong>maior frequência</strong> na casa</>}
              {` · ${total} cliente(s)`}
            </div>
          )}

          {/* Bulk selection bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.mut, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={clients.length > 0 && clients.every(c => selected.has(c.id))} onChange={toggleSelAll} style={{ width: 16, height: 16, accentColor: C.acc, cursor: 'pointer' }} />
              Selecionar página
            </label>
            {selected.size > 0 && <span style={{ color: C.acc, fontSize: 13, fontWeight: 700 }}>{selected.size} selecionado(s)</span>}
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>limpar</button>}
            <div style={{ flex: 1 }} />
            <Btn onClick={openBulk} disabled={selected.size === 0} style={{ background: '#25D36622', color: '#25D366', border: '1px solid #25D36644' }}>
              📲 Disparar WhatsApp ({selected.size})
            </Btn>
          </div>

          <Card>
            {ldg
              ? <div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>Carregando...</div>
              : clients.length === 0
                ? <div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>Nenhum cliente encontrado</div>
                : clients.map((c, i) => {
                  const count = ciCounts[c.id] ?? 0
                  const tier = loyalTier(count)
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderBottom: i < clients.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} style={{ width: 16, height: 16, accentColor: C.acc, cursor: 'pointer', flexShrink: 0 }} />
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: C.acc + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, overflow: 'hidden', border: `2px solid ${tier.color}44` }}>
                        {c.photo_url
                          ? <img loading="lazy" decoding="async" src={c.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          : tier.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>{c.full_name}</div>
                        <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                          {c.cpf ? fcpf(c.cpf) : ''}{c.cpf && c.phone ? ' · ' : ''}{c.phone ? ftel(c.phone) : ''}
                          {c.birth_date ? ` · 🎂 ${fd(c.birth_date)}` : ''}
                          {c.email ? ` · ${c.email}` : ''}
                        </div>
                      </div>
                      <span style={{ color: tier.color, fontSize: 12, fontWeight: 600, background: tier.color + '18', padding: '3px 8px', borderRadius: 8, flexShrink: 0 }}>
                        {count} visitas
                      </span>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {c.phone && (
                          <button onClick={() => setQuickWA({ name: c.full_name, phone: c.phone!, clientId: c.id })}
                            style={{ display: 'inline-flex', alignItems: 'center', background: '#25D36622', color: '#25D366', border: '1px solid #25D36644', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
                            💬
                          </button>
                        )}
                        <Btn onClick={() => openHistory(c)} variant="ghost" small>📋</Btn>
                        <Btn onClick={() => openEdit(c)} variant="ghost" small>✏️</Btn>
                        <Btn onClick={() => del(c)} variant="danger" small>🗑</Btn>
                      </div>
                    </div>
                  )
                })
            }
            {total > 30 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 0', marginTop: 12, borderTop: `1px solid ${C.brd}` }}>
                <Btn onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} variant="secondary" small>← Anterior</Btn>
                <span style={{ color: C.mut, fontSize: 13 }}>{page * 30 + 1}–{Math.min(page * 30 + 30, total)} de {total}</span>
                <Btn onClick={() => setPage(p => p + 1)} disabled={(page + 1) * 30 >= total} variant="secondary" small>Próximo →</Btn>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── ANIVERSÁRIOS TAB ── */}
      {tab === 'aniversarios' && (
        <>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={bdDays} onChange={e => setBdDays(e.target.value)}
              style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 14px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }}>
              {['7', '14', '30', '60', '90'].map(d => <option key={d} value={d}>Próximos {d} dias</option>)}
              <option value="custom">📆 Período personalizado</option>
            </select>
            {bdDays === 'custom' ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="date" value={bdStart} onChange={e => setBdStart(e.target.value)} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, minHeight: 44, fontFamily: 'inherit' }} />
                <span style={{ color: C.mut }}>→</span>
                <input type="date" value={bdEnd} onChange={e => setBdEnd(e.target.value)} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, minHeight: 44, fontFamily: 'inherit' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                {([['all', '📅 Todos'], ['week', '📆 Esta Semana'], ['month', '🗓️ Este Mês']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setBdFilter(id)}
                    style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${bdFilter === id ? C.gold : C.brd}`, background: bdFilter === id ? C.gold + '22' : 'transparent', color: bdFilter === id ? C.gold : C.mut, fontSize: 12, fontWeight: bdFilter === id ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: 1 }} />
            <Btn onClick={() => setBdSettings(true)} variant="secondary" style={{ minHeight: 44 }}>⚙️ Config</Btn>
            <Btn onClick={sendSelectedBdWA} disabled={sendingAll || bdSelected.size === 0}
              style={{ background: '#25D36622', color: '#25D366', border: '1px solid #25D36644' }}>
              {sendingAll ? '⏳ Enviando...' : `📲 Enviar selecionados (${bdSelected.size})`}
            </Btn>
          </div>

          {/* Barra de seleção */}
          {filteredBd.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.mut, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={(() => { const el = filteredBd.filter(c => c.phone && !wishSentThisYear(c)); return el.length > 0 && el.every(c => bdSelected.has(c.id)) })()}
                  onChange={toggleBdSelAll} style={{ width: 16, height: 16, accentColor: '#25D366', cursor: 'pointer' }} />
                Selecionar todos (não enviados)
              </label>
              {bdSelected.size > 0 && <span style={{ color: '#25D366', fontSize: 13, fontWeight: 700 }}>{bdSelected.size} selecionado(s)</span>}
              {bdSelected.size > 0 && <button onClick={() => setBdSelected(new Set())} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>limpar</button>}
              <div style={{ flex: 1 }} />
              <span style={{ color: C.mut, fontSize: 12 }}>💡 Selecione poucos por vez para evitar bloqueio do WhatsApp</span>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Hoje', value: bdClients.filter(c => c.daysUntil === 0).length, color: C.red, icon: '🎂' },
              { label: 'Esta semana', value: bdClients.filter(c => c.daysUntil <= 7).length, color: C.gold, icon: '🎈' },
              { label: bdDays === 'custom' ? 'Período' : bdFilter === 'week' ? 'Esta semana' : bdFilter === 'month' ? 'Este mês' : `${bdDays} dias`, value: filteredBd.length, color: C.acc, icon: '📅' },
            ].map(s => (
              <div key={s.label} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '14px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 24 }}>{s.icon}</div>
                <div style={{ color: s.color, fontWeight: 900, fontSize: 24, marginTop: 4 }}>{s.value}</div>
                <div style={{ color: C.mut, fontSize: 11, fontWeight: 600 }}>{s.label.toUpperCase()}</div>
              </div>
            ))}
          </div>

          {/* List */}
          {bdLoading
            ? <div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>Carregando...</div>
            : filteredBd.length === 0
              ? <Card><div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>Nenhum aniversariante no período</div></Card>
              : <Card>
                {filteredBd.map((c, i) => {
                  const sent = wishSentThisYear(c)
                  return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderBottom: i < filteredBd.length - 1 ? `1px solid ${C.brd}` : 'none', opacity: sent ? 0.6 : 1 }}>
                    <input type="checkbox" checked={bdSelected.has(c.id)} disabled={!c.phone || sent}
                      onChange={() => toggleBdSel(c.id)}
                      style={{ width: 16, height: 16, accentColor: '#25D366', cursor: c.phone && !sent ? 'pointer' : 'not-allowed', flexShrink: 0 }} />
                    <div style={{ fontSize: 28, flexShrink: 0 }}>{c.daysUntil === 0 ? '🎂' : '🎈'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {c.full_name}
                        {sent && <span style={{ color: '#25D366', fontSize: 11, fontWeight: 700, background: '#25D36618', border: '1px solid #25D36644', borderRadius: 6, padding: '1px 7px' }}>✅ Enviado</span>}
                      </div>
                      <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                        🎂 {fd(c.birth_date ?? '')}
                        {c.phone ? ` · 📱 ${ftel(c.phone)}` : ' · Sem telefone'}
                      </div>
                    </div>
                    <span style={{ color: dayColor(c.daysUntil), fontWeight: 700, fontSize: 13, flexShrink: 0, background: dayColor(c.daysUntil) + '18', padding: '3px 10px', borderRadius: 8 }}>
                      {dayLabel(c.daysUntil)}
                    </span>
                    {c.phone && (
                      <a href={`https://wa.me/55${cn(c.phone ?? '')}`} target="_blank" rel="noreferrer"
                        onClick={e => { e.preventDefault(); if (sent && !confirm('Este cliente já recebeu a mensagem este ano. Enviar mesmo assim?')) return; sendBdWA(c) }}
                        title={sent ? 'Já enviado este ano — clique para reenviar' : 'Enviar mensagem de aniversário'}
                        style={{ display: 'inline-flex', alignItems: 'center', background: '#25D36622', color: '#25D366', border: '1px solid #25D36644', borderRadius: 8, padding: '6px 12px', fontSize: 12, textDecoration: 'none', fontWeight: 700, flexShrink: 0 }}>
                        💬 {sent ? 'Reenviar' : 'WA'}
                      </a>
                    )}
                  </div>
                  )
                })}
              </Card>
          }
        </>
      )}
    </div>
  )
}
