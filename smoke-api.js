#!/usr/bin/env node
/**
 * Confere se as funcoes de servidor sobem depois de um deploy.
 *
 * Existe porque um import sem a extensao .js derrubou create-payment, mp-test e os
 * dois webhooks em producao — o projeto e ESM ("type": "module"), onde o Node exige
 * a extensao, mas o TypeScript compila sem reclamar. Ou seja: `tsc` passa, `build`
 * passa, e a funcao so quebra quando alguem chama. Venda de ingresso parada sem
 * nenhum sinal.
 *
 * Um GET em cada rota pega isso: erro de import derruba o modulo inteiro e vira 500,
 * qualquer que seja o metodo.
 *
 * Uso:  node smoke-api.js [url-base]
 */

const BASE = process.argv[2] ?? 'https://www.nightpassapp.com.br'

// Status esperado de um GET sem parametros. O que importa nao e o numero em si —
// e nao ser 500, que denuncia modulo que nao carregou.
const ROTAS = [
  ['geocode',         405],
  ['setup-status',    401],
  ['lista-preview',   200],
  ['mp-test',         405],
  ['create-payment',  405],
  ['webhook-payment', 200],
  ['webhook-asaas',   200],
  ['asaas-connect',   405],
  ['cron-operacao',   200],   // GET sem CRON_SECRET definido responde normal
]

const resultados = await Promise.all(ROTAS.map(async ([rota, esperado]) => {
  try {
    const r = await fetch(`${BASE}/api/${rota}`, { method: 'GET' })
    return { rota, esperado, obtido: r.status }
  } catch (e) {
    return { rota, esperado, obtido: 0, erro: e.message }
  }
}))

let falhou = false
for (const { rota, esperado, obtido, erro } of resultados) {
  const ok = obtido === esperado
  if (!ok) falhou = true
  const marca = ok ? 'ok  ' : 'FALHA'
  const extra = obtido === 500 ? '  <- funcao nao carregou (import? variavel de ambiente?)' : ''
  console.log(`  ${marca} ${rota.padEnd(17)} esperado ${esperado}, obtido ${obtido}${erro ? ' ' + erro : ''}${extra}`)
}

console.log(falhou ? '\nAlguma rota nao respondeu como devia.' : '\nTodas as rotas de servidor no ar.')
process.exit(falhou ? 1 : 0)
