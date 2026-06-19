// Importação de listas de convidados a partir de planilha (.xlsx / .xls / .csv)
// Mapeia colunas por cabeçalho (acentos/maiúsculas ignorados). Se não achar cabeçalho
// reconhecido, cai para modo posicional: col A = nome, B = telefone, C = gênero, D = nascimento.

export interface ImportedGuest {
  name: string
  phone: string | null
  gender: string | null // 'M' | 'F' | null
  birth_date: string | null // 'YYYY-MM-DD'
  cpf: string | null
}

function normHeader(h: string): string {
  return h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}
function digits(s: string): string { return (s || '').replace(/\D/g, '') }
function normGender(s: string): string | null {
  const g = (s || '').trim().toLowerCase()
  if (!g) return null
  if (g.startsWith('m')) return 'M'
  if (g.startsWith('f')) return 'F'
  return null
}
function parseBirth(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  if (!s) return null
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) {
    let y = m[3]
    if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}

export async function parseGuestsXlsx(file: File): Promise<ImportedGuest[]> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const out: ImportedGuest[] = []
  let recognized = 0
  for (const r of rows) {
    const keyMap: Record<string, string> = {}
    for (const k of Object.keys(r)) keyMap[normHeader(k)] = k
    const cell = (...ks: string[]): unknown => { for (const k of ks) { if (keyMap[k] != null) return r[keyMap[k]] } return '' }
    const str = (...ks: string[]) => String(cell(...ks) ?? '').trim()
    const name = str('nome', 'nomecompleto', 'name', 'convidado', 'cliente')
    const phone = digits(str('telefone', 'celular', 'phone', 'tel', 'whatsapp', 'fone', 'contato'))
    const gender = normGender(str('genero', 'sexo', 'gender'))
    const birth = parseBirth(cell('nascimento', 'datadenascimento', 'datanascimento', 'aniversario', 'nasc', 'birthdate', 'dtnasc'))
    const cpf = digits(str('cpf', 'documento', 'doc'))
    if (name || phone) recognized++
    if (!name && !phone) continue
    out.push({ name: name || `Convidado ${phone}`, phone: phone || null, gender, birth_date: birth, cpf: cpf || null })
  }

  // Fallback posicional: planilha sem cabeçalho reconhecido
  if (recognized === 0) {
    const arr = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    for (const row of arr) {
      const name = String(row[0] ?? '').trim()
      if (!name) continue
      out.push({
        name,
        phone: digits(String(row[1] ?? '')) || null,
        gender: normGender(String(row[2] ?? '')),
        birth_date: parseBirth(row[3]),
        cpf: null,
      })
    }
  }
  return out
}
