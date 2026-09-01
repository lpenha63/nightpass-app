// Esta funcao servia um prototipo do painel NightPass (marco/2026), substituido pelo
// app em https://www.nightpassapp.com.br.
//
// A versao antiga ficou no ar publicamente (verify_jwt: false) e a tela de login dela
// exibia, em texto puro, os e-mails de contas reais e a senha padrao. Ou seja: a URL
// entregava credenciais de acesso ao painel para qualquer um.
//
// O corpo foi substituido por esta resposta. Nao ha mais pagina, nao ha mais chave
// anonima embutida e nao ha mais credencial nenhuma neste arquivo.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const DESTINO = "https://www.nightpassapp.com.br"

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  // 410 Gone: o recurso existiu e foi removido de proposito. Quem tiver a URL velha
  // salva descobre para onde ir, em vez de ver uma tela quebrada.
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>NightPass</title></head>` +
    `<body style="background:#0a0e1a;color:#e2e8f0;font-family:-apple-system,sans-serif;` +
    `min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px">` +
    `<div><div style="font-size:40px;margin-bottom:12px">&#127917;</div>` +
    `<h1 style="font-size:20px;margin:0 0 8px">Este endere&ccedil;o saiu do ar</h1>` +
    `<p style="color:#94a3b8;font-size:14px;margin:0 0 16px">O NightPass agora fica em:</p>` +
    `<a href="${DESTINO}" style="color:#3b82f6;font-size:15px;font-weight:700">nightpassapp.com.br</a>` +
    `</div></body></html>`

  return new Response(html, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...cors },
  })
})
