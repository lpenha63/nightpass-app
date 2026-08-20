import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const dist = join(root, 'dist')

// Mesmo arquivo que o vite leu — os dois PRECISAM dizer a mesma coisa
const id = JSON.parse(readFileSync(join(root, 'build-id.json'), 'utf8'))
const APP_BUILD = id.build
const BUILD_AT = id.at

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
