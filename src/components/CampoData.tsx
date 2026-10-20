import { useState, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

/**
 * Campo de data que aceita DIGITAR, além do seletor do celular.
 *
 * `<input type="date">` não abre teclado no celular — por desenho, ele abre o
 * seletor nativo (roda no iPhone, calendário no Android). Para data de
 * nascimento isso é sofrido: chegar a 1985 girando a roda leva mais tempo do
 * que digitar oito números.
 *
 * Aqui o campo é texto com teclado numérico e máscara dd/mm/aaaa, e o botão 📅
 * abre o seletor nativo para quem preferir. As duas formas continuam valendo.
 *
 * Fala ISO ('aaaa-mm-dd') com quem usa, igual ao input de data — min/max e as
 * faixas de limitesDeData seguem funcionando sem mudança.
 */

interface Props {
  value?: string | null
  /** Recebe ISO 'aaaa-mm-dd', ou '' quando o campo fica vazio. */
  onChange: (iso: string) => void
  min?: string
  max?: string
  disabled?: boolean
  style?: CSSProperties
  className?: string
  /** Mostrado quando o campo está vazio. */
  placeholder?: string
  'aria-label'?: string
}

const soDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 8)

function isoParaBr(iso?: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function mascara(digitos: string): string {
  if (digitos.length <= 2) return digitos
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`
}

/** Só devolve ISO quando os 8 dígitos formam uma data que existe de verdade. */
function brParaIso(digitos: string): string | null {
  if (digitos.length !== 8) return null
  const d = +digitos.slice(0, 2), m = +digitos.slice(2, 4), a = +digitos.slice(4)
  if (m < 1 || m > 12 || d < 1 || a < 1) return null
  // 31/02 não existe: o Date "corrige" para 03/03, então conferimos a volta.
  const dt = new Date(a, m - 1, d)
  if (dt.getFullYear() !== a || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function CampoData({
  value, onChange, min, max, disabled, style, className, placeholder = 'dd/mm/aaaa',
  'aria-label': ariaLabel,
}: Props) {
  const [texto, setTexto] = useState(() => isoParaBr(value))
  // Data completa que não vale: 31/02, ou fora da faixa (nascimento em 1850).
  // Sem sinal na tela, a pessoa vê "31/02/1994" escrito e acha que salvou.
  const [invalido, setInvalido] = useState(false)
  const oculto = useRef<HTMLInputElement>(null)

  // Mudou por fora (reset do formulário, carregar registro): acompanha.
  useEffect(() => { setTexto(isoParaBr(value)); setInvalido(false) }, [value])

  function digitou(bruto: string) {
    const dig = soDigitos(bruto)
    setTexto(mascara(dig))
    if (dig.length === 0) { setInvalido(false); onChange(''); return }

    // Data pela metade não vira valor: avisar a cada tecla faria a tela recarregar
    // no meio da digitação — foi esse o defeito do período em Relatórios.
    if (dig.length < 8) { setInvalido(false); return }

    const iso = brParaIso(dig)
    // min/max valem para quem DIGITA também. Sem isto, a faixa de limitesDeData
    // (que existe para barrar ano absurdo) seria contornada pelo teclado.
    const naFaixa = !!iso && (!min || iso >= min) && (!max || iso <= max)
    setInvalido(!naFaixa)
    if (naFaixa && iso) onChange(iso)
  }

  function abrirSeletor() {
    const el = oculto.current
    if (!el || disabled) return
    // showPicker exige gesto do usuário e não existe em todo navegador.
    const comPicker = el as HTMLInputElement & { showPicker?: () => void }
    if (typeof comPicker.showPicker === 'function') { try { comPicker.showPicker(); return } catch { /* cai no clique */ } }
    el.focus(); el.click()
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', width: '100%' }}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={texto}
        onChange={e => digitou(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
        style={{
          ...style, width: '100%', paddingRight: 38,
          ...(invalido ? { borderColor: '#f87171', color: '#f87171' } : null),
        }}
      />
      <button type="button" onClick={abrirSeletor} disabled={disabled} tabIndex={-1}
        aria-label="Abrir calendário"
        style={{
          position: 'absolute', right: 2, top: 2, bottom: 2, width: 34,
          background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer',
          fontSize: 15, lineHeight: 1, opacity: disabled ? 0.4 : 0.75, padding: 0,
        }}>
        📅
      </button>
      {invalido && (
        <span role="alert" style={{ position: 'absolute', left: 0, top: '100%', marginTop: 3, color: '#f87171', fontSize: 11, whiteSpace: 'nowrap' }}>
          Data inválida
        </span>
      )}
      {/* O input de data de verdade, só para abrir o seletor nativo. Fica fora do
          fluxo mas NÃO com display:none — o navegador recusa showPicker em campo
          escondido assim. */}
      <input
        ref={oculto}
        type="date"
        value={value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''}
        min={min}
        max={max}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={e => { const v = e.target.value; setTexto(isoParaBr(v)); onChange(v) }}
        style={{
          position: 'absolute', right: 6, bottom: 0, width: 1, height: 1,
          opacity: 0, pointerEvents: 'none', border: 'none', padding: 0,
        }}
      />
    </div>
  )
}
