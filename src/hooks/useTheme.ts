import { useReducer, useEffect } from 'react'
import { getTheme, toggleTheme, applyTheme, subscribeTheme, type ThemeName } from '../constants/theme'

// Re-renderiza o componente quando o tema muda (para estilos inline recalcularem).
export function useTheme() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => subscribeTheme(force), [])
  return { theme: getTheme(), toggle: toggleTheme, setTheme: (t: ThemeName) => applyTheme(t) }
}
