import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const dist = join(root, 'dist')

// Mesmo arquivo que o vite leu — os dois PRECISAM dizer a mesma coisa
const id = JSON.parse(readFileSync(join(root, 'build-id.json'), 'utf8'))
const APP_BUILD = id.build
const BUILD_AT = id.at

// Supabase do ambiente (Production ou Preview). Definidas na Vercel por escopo.
// .trim() NAO e detalhe: os valores guardados na Vercel terminam com quebra de
// linha. Sem isso a quebra entra DENTRO de uma string JavaScript, o que e erro de
// sintaxe: o script inteiro morre e a pagina publica abre EM BRANCO.
// Aconteceu com as 5 paginas estaticas de uma vez.
const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const SB_ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
// Cinto de seguranca: valor com aspas, espaco ou quebra corromperia o arquivo.
// Melhor nao substituir nada do que publicar pagina quebrada.
const SB_OK = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SB_URL) && /^[\w.-]+$/.test(SB_ANON)
if ((SB_URL || SB_ANON) && !SB_OK) {
  console.warn('AVISO: VITE_SUPABASE_URL/ANON_KEY em formato inesperado — estaticos mantidos como estao.')
}
const ESTATICOS_COM_SUPABASE = ['agenda.html', 'lista.html', 'convite.html', 'tarefa.html', 'nightpass.html']

const files = [
  'nightpass.html',
  'lista.html',
  'convite.html',
  'tarefa.html',
  'agenda.html',
  'sw.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon.svg',
]

for (const file of files) {
  const src = join(root, file)
  const dest = join(dist, file)
  if (existsSync(src)) {
    copyFileSync(src, dest)
    // Carimba a versão nos estáticos. O sw.js usava um número escrito à mão
    // ('nightpass-v9'): bastava esquecer de subir para todo mundo ficar com
    // arquivo velho. Agora o nome do cache muda sozinho a cada publicação.
    if (file === 'sw.js' || file === 'agenda.html') {
      const txt = readFileSync(dest, 'utf8').split('__APP_BUILD__').join(APP_BUILD)
      writeFileSync(dest, txt)
      console.log(`  ↳ versão carimbada em ${file}`)
    }
    // As paginas estaticas tinham a URL e a chave do Supabase escritas dentro delas.
    // Num ambiente de teste isso seria um furo: metade do app pareceria isolada e a
    // outra metade continuaria gravando em producao. Aqui elas passam a seguir a env
    // do build. Sem env definida, o arquivo fica como esta (util no dev local).
    if (SB_OK && ESTATICOS_COM_SUPABASE.includes(file)) {
      let txt = readFileSync(dest, 'utf8')
      const antes = txt
      txt = txt.replace(/https:\/\/[a-z0-9]{20}\.supabase\.co/g, SB_URL)
               .replace(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, SB_ANON)
      if (txt !== antes) {
        writeFileSync(dest, txt)
        console.log(`  ↳ Supabase do ambiente aplicado em ${file}`)
      }
    }
    console.log(`Copied: ${file}`)
  } else {
    console.warn(`Not found (skipped): ${file}`)
  }
}

// Arquivo que o app consulta para saber se existe versão mais nova publicada
writeFileSync(join(dist, 'version.json'), JSON.stringify({
  version: id.version, build: APP_BUILD, at: BUILD_AT,
}, null, 2))
console.log(`version.json: ${APP_BUILD}`)

console.log('Static files copy done.')
