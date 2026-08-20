// Identidade do build — calculada UMA vez e lida por todo mundo.
//
// Por que existe: o vite.config.ts (que carimba o bundle) e o copy-static.js (que
// escreve o version.json) rodam em processos separados. Se cada um calculasse a
// versão por conta própria e os valores divergissem por um segundo que fosse, o app
// compararia "bundle != version.json" e ficaria avisando "nova versão disponível"
// para sempre. Então o número nasce aqui, vai para build-id.json, e os dois leem.
import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function sha() {
  // Na Vercel o git pode não existir no container, mas a env vem pronta
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'local' }
}

const d = new Date()
const p2 = (n) => String(n).padStart(2, '0')
const carimbo = `${p2(d.getDate())}${p2(d.getMonth() + 1)}t${p2(d.getHours())}${p2(d.getMinutes())}`

// O carimbo de data entra SEMPRE, não só quando há alteração não commitada.
// Motivo: publicando pela CLI com o repositório sujo, a Vercel compila usando o hash
// do último commit — o id sairia idêntico em toda publicação, o nome do cache do
// service worker não mudaria e o aviso de "nova versão" jamais apareceria.
// Como este arquivo roda UMA vez por build, bundle e version.json continuam iguais.
const build = `${pkg.version}+${sha()}.${carimbo}`

writeFileSync(join(root, 'build-id.json'), JSON.stringify({
  version: pkg.version,
  build,
  at: d.toISOString(),
}, null, 2))

console.log(`build-id: ${build}`)
