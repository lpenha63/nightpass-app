import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { tokenMercadoPago, chaveAsaas, asaas } from './_gateways.js'
import { sendTicketWhatsApp } from './_ticket-wa.js'
import { sendTicketEmail } from './_ticket-email.js'

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function confirmAndGenerateTickets(
  sb: ReturnType<typeof supabaseAdmin>,
  orderId: string,
  eventId: string,
  houseId: string,
  batchId: string,
  quantity: number,
  holderName: string,
  holderNames?: string[] | null
) {
  await sb.from('ticket_orders').update({ payment_status: 'paid' }).eq('id', orderId)

  // Ingresso nominal: cada unidade sai no nome informado. Sem nome, fica no do comprador.
  const tickets = Array.from({ length: quantity }, (_, i) => ({
    order_id: orderId,
    event_id: eventId,
    house_id: houseId,
    token: crypto.randomUUID(),
    holder_name: holderNames?.[i]?.trim() || holderName,
    checked_in: false,
  }))
  await sb.from('tickets').insert(tickets)
  await sb.rpc('increment_batch_sold', { p_batch_id: batchId, p_qty: quantity })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { event_id, batch_id, house_id, buyer_name, buyer_cpf, buyer_phone, buyer_email, quantity } = req.body
  // 'pix' gera o QR aqui mesmo (sem sair do site); 'card' manda para o Checkout Pro,
  // porque dado de cartão não pode passar pelo nosso servidor.
  const metodo: 'pix' | 'card' = req.body?.method === 'card' ? 'card' : 'pix'
  const holderNames: string[] = Array.isArray(req.body?.holder_names)
    ? req.body.holder_names.slice(0, 20).map((n: unknown) => String(n ?? '').trim())
    : []

  if (!event_id || !batch_id || !house_id || !buyer_name || !buyer_phone || !quantity) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const sb = supabaseAdmin()

  // O token do MP vem de house_secrets, nao de houses: a linha de `houses` e legivel
  // publicamente (as paginas de ingresso mostram nome e endereco da casa) e RLS e por
  // LINHA, nao por coluna — enquanto o token morou la, qualquer um o lia pela API.
  // Aqui isso funciona porque `sb` e service_role, que ignora RLS.
  const [{ data: batch }, { data: house }, segredo, { data: ev }, credAsaas, prefs] = await Promise.all([
    sb.from('ticket_batches').select('price_cents,name,quantity,sold,active,service_fee_pct,nominal').eq('id', batch_id).single(),
    sb.from('houses').select('pix_key,pix_holder,name').eq('id', house_id).single(),
    tokenMercadoPago(sb, house_id),
    sb.from('events').select('name').eq('id', event_id).single(),
    chaveAsaas(sb, house_id),
    sb.from('house_payment_providers').select('provider,priority')
      .eq('house_id', house_id).eq('active', true).order('priority'),
  ])
  // Empate mantem a Asaas na frente, que era o comportamento anterior.
  const ordem = (prefs.data ?? []) as Array<{ provider: string; priority: number }>
  const pri = (n: string) => ordem.find(o => o.provider === n)?.priority ?? 100
  const asaasPrimeiro = pri('asaas') <= pri('mercadopago')
  const mpToken: string | null = segredo

  if (!batch) return res.status(404).json({ error: 'Lote não encontrado' })
  if (!batch.active) return res.status(400).json({ error: 'Lote inativo' })
  if (batch.quantity - batch.sold < quantity) return res.status(400).json({ error: 'Ingressos insuficientes' })
  if (!house) return res.status(404).json({ error: 'Casa não encontrada' })

  // Lote nominal: sem os nomes o ingresso não serve para conferência na portaria
  if (batch.nominal) {
    const preenchidos = holderNames.filter(n => n.length >= 2)
    if (preenchidos.length < quantity) {
      return res.status(400).json({ error: 'Informe o nome de cada participante' })
    }
  }

  // Taxa de serviço: percentual sobre o ingresso, arredondado por unidade para o
  // comprador ver a mesma conta que aparece na tela (preço + taxa) × quantidade.
  const feePct = Number(batch.service_fee_pct ?? 0)
  const feeUnit = Math.round(batch.price_cents * feePct / 100)
  const service_fee_cents = feeUnit * quantity
  const amount_cents = batch.price_cents * quantity + service_fee_cents

  // Create order
  const { data: order, error: orderErr } = await sb.from('ticket_orders').insert({
    house_id, event_id, batch_id,
    buyer_name, buyer_cpf: buyer_cpf || null,
    buyer_phone, buyer_email: buyer_email || null,
    quantity, amount_cents, service_fee_cents,
    holder_names: holderNames.length ? holderNames.slice(0, quantity) : null,
    payment_status: 'pending',
    payment_method: 'mp',
  }).select().single()

  if (orderErr || !order) return res.status(500).json({ error: 'Erro ao criar pedido' })

  // Free ticket — auto confirm
  if (amount_cents === 0) {
    await confirmAndGenerateTickets(sb, order.id, event_id, house_id, batch_id, quantity, buyer_name, holderNames)
    await Promise.allSettled([
      sendTicketWhatsApp(sb, { houseId: house_id, eventId: event_id, orderId: order.id, buyerName: buyer_name, buyerPhone: buyer_phone, quantity }),
      sendTicketEmail(sb, { houseId: house_id, eventId: event_id, orderId: order.id, buyerName: buyer_name, buyerEmail: buyer_email, quantity }),
    ])
    return res.json({ mode: 'free', order_id: order.id })
  }

  // Checkout Pro: uma preferência abre crédito, débito, PIX, boleto e saldo MP numa tela só.
  // Cartão não pode passar pelo nosso servidor, então o comprador paga no ambiente do MP.
  const appUrl = process.env.APP_URL ?? 'https://nightpass-app.vercel.app'
  let mpErro: string | null = null

  // ── Asaas: PIX com QR na nossa propria pagina ──
  // Vem antes do Mercado Pago de proposito: se a casa conectou a Asaas, e por ela que
  // ela quer receber. Fluxo da Asaas exige cliente cadastrado antes da cobranca, e o
  // aviso de pagamento e por conta (registrado uma vez em /api/asaas-connect), nao por
  // cobranca como no MP — por isso aqui nao vai notification_url.
  // Qual gateway atende: o de menor `priority`, escolhido pelo dono da casa na tela de
  // Configuracoes. Antes a Asaas vinha na frente por estar escrita primeiro aqui — uma
  // decisao de negocio escondida na ordem do codigo, que ninguem tinha como mudar.
  if (metodo === 'pix' && credAsaas && asaasPrimeiro) {
    try {
      const cli = await asaas<{ id?: string }>(credAsaas.api_key, '/customers', {
        method: 'POST',
        body: {
          name: buyer_name,
          cpfCnpj: (buyer_cpf ?? '').replace(/\D/g, '') || undefined,
          email: buyer_email || undefined,
          mobilePhone: buyer_phone.replace(/\D/g, ''),
          externalReference: order.id,
        },
      })
      if (!cli.ok || !cli.data?.id) throw new Error(cli.erro ?? 'Asaas nao criou o cliente')

      // Vencimento hoje: ingresso de festa nao tem por que vencer depois. O QR do PIX
      // continua pagavel ate o vencimento.
      const hoje = new Date().toISOString().slice(0, 10)
      const cob = await asaas<{ id?: string }>(credAsaas.api_key, '/payments', {
        method: 'POST',
        body: {
          customer: cli.data.id,
          billingType: 'PIX',
          value: amount_cents / 100,
          dueDate: hoje,
          description: `${quantity}x ${batch.name} - ${ev?.name ?? house.name}`,
          externalReference: order.id,
        },
      })
      if (!cob.ok || !cob.data?.id) throw new Error(cob.erro ?? 'Asaas nao criou a cobranca')

      const qr = await asaas<{ encodedImage?: string; payload?: string }>(
        credAsaas.api_key, `/payments/${cob.data.id}/pixQrCode`)
      if (!qr.ok || !qr.data?.payload) throw new Error(qr.erro ?? 'Asaas nao devolveu o QR do PIX')

      await sb.from('ticket_orders')
        .update({ payment_id: String(cob.data.id), payment_method: 'pix' }).eq('id', order.id)

      // Mesmo formato de resposta do MP: a pagina de compra nao precisa saber qual
      // gateway atendeu.
      return res.json({
        mode: 'mp',
        order_id: order.id,
        amount_cents,
        service_fee_cents,
        qr_code: qr.data.payload,
        qr_code_base64: qr.data.encodedImage,
      })
    } catch (e) {
      console.error('Asaas PIX error:', e)
      mpErro = (e as Error)?.message ?? 'Falha ao gerar o PIX na Asaas'
      // Cai para o fluxo abaixo: tenta o Mercado Pago e, sem ele, a chave PIX manual.
    }
  }

  // ── PIX direto: QR gerado aqui e exibido na nossa página ──
  // Sem tela do Mercado Pago, sem login e sem captcha. Também não esbarra no bloqueio
  // de "pagar para si mesmo": o QR é um PIX comum, pagável por qualquer banco.
  if (metodo === 'pix' && mpToken) {
    try {
      const { MercadoPagoConfig, Payment } = await import('mercadopago')
      const client = new MercadoPagoConfig({ accessToken: mpToken })
      const paymentApi = new Payment(client)

      const mpPay = await paymentApi.create({
        body: {
          transaction_amount: amount_cents / 100,
          payment_method_id: 'pix',
          description: `${quantity}x ${batch.name} – ${ev?.name ?? house.name}`,
          external_reference: order.id,
          notification_url: `${appUrl}/api/webhook-payment?order=${order.id}`,
          payer: {
            email: buyer_email || `${buyer_phone.replace(/\D/g, '')}@pix.nightpass.app`,
            first_name: buyer_name.split(' ')[0],
            last_name: buyer_name.split(' ').slice(1).join(' ') || 'NightPass',
            ...(buyer_cpf ? { identification: { type: 'CPF', number: buyer_cpf.replace(/\D/g, '') } } : {}),
          },
        },
      })

      const qr = mpPay.point_of_interaction?.transaction_data
      if (!qr?.qr_code) throw new Error('Mercado Pago não devolveu o QR do PIX')
      await sb.from('ticket_orders').update({ payment_id: String(mpPay.id), payment_method: 'pix' }).eq('id', order.id)

      return res.json({
        mode: 'mp',
        order_id: order.id,
        amount_cents,
        service_fee_cents,
        qr_code: qr.qr_code,
        qr_code_base64: qr.qr_code_base64,
      })
    } catch (e) {
      console.error('Mercado Pago PIX error:', e)
      const err = e as { message?: string; cause?: Array<{ description?: string }> }
      mpErro = err?.cause?.[0]?.description ?? err?.message ?? 'falha ao gerar o PIX'
      // cai para o Checkout Pro abaixo, que ainda pode resolver
    }
  }

  if (mpToken) {
    try {
      const { MercadoPagoConfig, Preference } = await import('mercadopago')
      const client = new MercadoPagoConfig({ accessToken: mpToken })
      const prefApi = new Preference(client)

      const items = [{
        id: batch_id,
        title: `${batch.name} — ${ev?.name ?? house.name}`,
        quantity,
        unit_price: batch.price_cents / 100,
        currency_id: 'BRL',
      }]
      // Taxa vai como item separado para o comprador ver o que está pagando
      if (feeUnit > 0) {
        items.push({ id: `${batch_id}-taxa`, title: 'Taxa de serviço', quantity, unit_price: feeUnit / 100, currency_id: 'BRL' })
      }

      const pref = await prefApi.create({
        body: {
          items,
          external_reference: order.id,
          // O id do pedido viaja na URL: o webhook do MP manda só o id do pagamento,
          // e sem isso não daria para saber de qual casa é o token para consultá-lo.
          notification_url: `${appUrl}/api/webhook-payment?order=${order.id}`,
          statement_descriptor: (house.name ?? 'NightPass').slice(0, 22),
          back_urls: {
            success: `${appUrl}/pagamento/${order.id}`,
            pending: `${appUrl}/pagamento/${order.id}`,
            failure: `${appUrl}/pagamento/${order.id}`,
          },
          auto_return: 'approved',
          // PIX e boleto ficam de fora: o PIX já é resolvido na nossa própria tela,
          // e boleto não serve para ingresso (compensa em dias, o evento já passou).
          payment_methods: {
            excluded_payment_types: [{ id: 'bank_transfer' }, { id: 'ticket' }],
          },
          payer: {
            name: buyer_name.split(' ')[0],
            surname: buyer_name.split(' ').slice(1).join(' ') || 'NightPass',
            email: buyer_email || `${buyer_phone.replace(/\D/g, '')}@pix.nightpass.app`,
            ...(buyer_cpf ? { identification: { type: 'CPF', number: buyer_cpf.replace(/\D/g, '') } } : {}),
          },
        },
      })

      if (!pref.init_point) throw new Error('Mercado Pago não devolveu o link de pagamento')
      await sb.from('ticket_orders').update({ mp_preference_id: String(pref.id) }).eq('id', order.id)

      return res.json({
        mode: 'checkout',
        order_id: order.id,
        amount_cents,
        service_fee_cents,
        init_point: pref.init_point,
      })
    } catch (e) {
      console.error('Mercado Pago error:', e)
      // Guarda o motivo: sem isto a casa nunca descobre por que a venda não fechou
      const err = e as { message?: string; cause?: Array<{ description?: string }> }
      mpErro = err?.cause?.[0]?.description ?? err?.message ?? 'falha ao gerar cobrança'
      // segue para o PIX manual
    }
  }

  // Sem Mercado Pago E sem chave PIX manual não há como o comprador pagar.
  // Antes caía num "Pague via PIX" sem chave nenhuma — o pedido ficava pendente para sempre
  // e nem a casa nem o comprador entendiam o que aconteceu.
  if (!house.pix_key) {
    await sb.from('ticket_orders')
      .update({ payment_status: 'cancelled', notes: mpErro ? `Falha no Mercado Pago: ${mpErro}` : 'Casa sem forma de pagamento configurada' })
      .eq('id', order.id)
    return res.status(503).json({
      error: 'Pagamento indisponível no momento. Fale com a casa para garantir seu ingresso.',
      reason: mpErro ?? 'sem_forma_de_pagamento',
    })
  }

  // Manual PIX fallback
  return res.json({
    mode: 'manual',
    order_id: order.id,
    amount_cents,
    pix_key: house.pix_key,
    pix_holder: house.pix_holder,
  })
}
