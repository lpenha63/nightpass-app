// Gera os rotulos de texto como PNG e imprime em base64 para embutir em api/icone.ts.
// Roda AQUI, nao no servidor: a Vercel nao tem fonte instalada (texto SVG sai como
// quadradinho vazio). Rasterizando na maquina de desenvolvimento, o runtime fica
// independente de fonte.
const sharp = require('sharp')
const fs = require('fs')

const PALAVRAS = { agenda: 'AGENDA', promoter: 'PROMOTER', admin: 'NIGHTPASS' }

;(async () => {
  const saida = {}
  for (const [app, txt] of Object.entries(PALAVRAS)) {
    let png = await sharp({
      text: {
        text: `<span foreground="white" letter_spacing="2000">${txt}</span>`,
        rgba: true, font: 'Arial Bold', dpi: 600,
      },
    }).png().toBuffer()
    // normaliza para 720 de largura: no runtime so se reduz, nunca se amplia
    // 480 de largura basta: o maior uso no icone e ~360. Paleta de 2 cores porque
    // o rotulo e branco puro sobre transparente — corta o base64 em ~4x.
    png = await sharp(png).resize({ width: 480, fit: 'inside' })
      .png({ compressionLevel: 9, palette: true, colors: 4 }).toBuffer()
    const m = await sharp(png).metadata()
    saida[app] = png.toString('base64')
    fs.writeFileSync(process.env.S + '/rotulo-' + app + '.png', png)
    console.log(`${app.padEnd(9)} ${txt.padEnd(10)} ${m.width}x${m.height}  base64=${saida[app].length} chars`)
  }
  fs.writeFileSync(process.env.S + '/rotulos.json', JSON.stringify(saida))
  console.log('-> rotulos.json')
})()
