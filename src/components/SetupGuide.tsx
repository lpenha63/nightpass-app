import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'

// Guia de configuração inicial — mostrado no topo de Configurações.
// Preferi isto a um manual em PDF: documento estático envelhece e ninguém lê, enquanto
// um checklist que diz "faltam 2 passos" faz o cliente novo terminar a configuração.
// Cada item traz o passo a passo, e o estado é verificado de verdade (banco + servidor).

type Estado = 'ok' | 'faltando' | 'parcial'

interface Passo {
  id: string
  titulo: string
  icone: string
  estado: Estado
  resumo: string            // por que isso importa
  detalhe: string           // situação atual
  passos: string[]          // como fazer
  opcional?: boolean
}

export function SetupGuide({ houseId }: { houseId: string }) {
  const [passos, setPassos] = useState<Passo[] | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [minimizado, setMinimizado] = useState(false)

  useEffect(() => { carregar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [houseId])

  async function carregar() {
    const [casaR, waR, areasR, evR, srv, pagR] = await Promise.all([
      supabase.from('houses').select('name,logo_url,pix_key,pix_holder,lat,lng').eq('id', houseId).single(),
      supabase.from('whatsapp_config').select('active,api_url,instance_name,api_key').eq('house_id', houseId).limit(1).maybeSingle(),
      supabase.from('work_areas').select('id', { count: 'exact', head: true }).eq('house_id', houseId).eq('active', true),
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('house_id', houseId),
      statusServidor(),
      // SIM/NAO do pagamento. Antes o token do Mercado Pago era trazido para o
      // navegador so para conferir o prefixo "APP_USR-".
      supabase.rpc('house_payment_status', { p_house: houseId }),
    ])
    const h = casaR.data
    const wa = waR.data
    const pag = (pagR.data as Array<{ tem_pix?: boolean; provedores?: string[] }> | null)?.[0]
    const mpOk = (pag?.provedores ?? []).includes('mercadopago')
    const pixOk = !!pag?.tem_pix

    setPassos([
      {
        id: 'casa', icone: '🏠', titulo: 'Dados da casa',
        estado: h?.name && h?.logo_url ? 'ok' : h?.name ? 'parcial' : 'faltando',
        resumo: 'O nome e a logo aparecem nos links de lista, na página de ingressos e nos ingressos emitidos.',
        detalhe: !h?.logo_url ? 'Falta a logo — sem ela o link compartilhado no WhatsApp fica sem imagem.' : 'Nome e logo preenchidos.',
        passos: [
          'Preencha nome, CNPJ, telefone e endereço na seção "Dados da casa" abaixo.',
          'Envie a logo em formato quadrado (mínimo 500×500) — é ela que aparece na prévia dos links.',
        ],
      },
      {
        id: 'pagamento', icone: '💳', titulo: 'Receber por ingresso',
        estado: mpOk ? 'ok' : pixOk ? 'parcial' : 'faltando',
        resumo: 'Sem isto os lotes aparecem para venda, mas o comprador não consegue pagar.',
        detalhe: mpOk
          ? 'Mercado Pago conectado — PIX automático e cartão liberados.'
          : pixOk ? 'Só PIX manual: você precisa confirmar cada pagamento na mão.'
          : 'Nenhuma forma de recebimento configurada.',
        passos: [
          'Acesse mercadopago.com.br/developers com a conta que vai RECEBER o dinheiro.',
          'Menu "Integrações" → "Criar aplicação" → produto "Pagamentos online" → "Com um desenvolvimento próprio".',
          'Na aplicação criada, vá em "Credenciais de produção" e copie o Access Token (começa com APP_USR-, ~75 caracteres — não confunda com a Public Key, que é curta).',
          'Cole na seção "Mercado Pago" abaixo, salve e clique em "Testar token".',
          'IMPORTANTE: cadastre uma chave PIX DENTRO da conta Mercado Pago (app do MP → Pix → Minhas chaves). Sem ela o QR não é gerado e a venda falha.',
          'Opcional: preencha também chave PIX e titular na seção PIX, como alternativa manual.',
        ],
      },
      {
        id: 'whatsapp', icone: '💬', titulo: 'WhatsApp',
        estado: wa?.active && wa?.api_url && wa?.api_key ? 'ok' : wa?.api_url ? 'parcial' : 'faltando',
        resumo: 'Entrega o ingresso ao comprador, avisa a equipe de novas tarefas e dispara convites.',
        detalhe: wa?.active ? 'Conectado.' : wa?.api_url ? 'Configurado mas desativado.' : 'Não configurado.',
        passos: [
          'Você precisa de uma instância da Evolution API (self-hosted, ex: Railway).',
          'Preencha URL da API, nome da instância e a API Key na seção "Integração WhatsApp" abaixo.',
          'Ative a chave e escaneie o QR de pareamento na aba WhatsApp para conectar o número.',
          'Use um número dedicado da casa — não o pessoal de alguém.',
        ],
      },
      {
        id: 'email', icone: '📧', titulo: 'Ingresso por e-mail',
        estado: srv?.email ? 'ok' : 'faltando',
        opcional: true,
        resumo: 'Segundo canal de entrega: quem errar o telefone ou perder a mensagem ainda recebe.',
        detalhe: srv?.email ? `Ativo — remetente ${srv.email_from}.` : 'Não configurado (a entrega hoje é só por WhatsApp).',
        passos: [
          'Crie uma conta em resend.com (plano grátis cobre 3.000 e-mails/mês).',
          'Verifique um domínio: o Resend mostra os registros SPF e DKIM para incluir no DNS. Sem domínio verificado o e-mail cai em spam.',
          'Gere uma API Key.',
          'Na Vercel → Settings → Environment Variables, crie RESEND_API_KEY (a chave) e RESEND_FROM (ex: ingressos@seudominio.com.br), ambas em Production.',
          'Publique de novo o projeto para as funções enxergarem as variáveis.',
          'Isto é feito UMA vez para toda a plataforma: o nome de cada casa vai no remetente, então clientes novos não precisam mexer em DNS.',
        ],
      },
      {
        id: 'equipe', icone: '👷', titulo: 'Áreas e equipe',
        estado: (areasR.count ?? 0) > 0 ? 'ok' : 'faltando',
        resumo: 'As áreas organizam a escala, o check-in da equipe e o rateio de custo por setor.',
        detalhe: `${areasR.count ?? 0} área(s) ativa(s).`,
        passos: [
          'Aba Equipe → "Administrar áreas": ajuste as áreas para a realidade da casa (bar, portaria, cozinha...).',
          'Cadastre a equipe com valor por dia e, se for pagar por hora, o valor por hora.',
          'Preencha a chave PIX de cada pessoa — é o que sai na folha de pagamento.',
        ],
      },
      {
        id: 'local', icone: '📍', titulo: 'Localização da casa',
        estado: h?.lat && h?.lng ? 'ok' : 'faltando',
        opcional: true,
        resumo: 'Permite que a equipe bata ponto pelo celular só quando estiver de fato no local.',
        detalhe: h?.lat && h?.lng ? 'Coordenadas definidas.' : 'Sem coordenadas — o ponto por app aceita de qualquer lugar.',
        passos: [
          'Na seção "Localização" abaixo, clique em "Usar minha localização" estando dentro da casa.',
          'Ou cole as coordenadas do Google Maps (clique com o botão direito no ponto → copiar).',
          'Ajuste o raio conforme o tamanho do imóvel (o padrão de 250m serve para a maioria).',
        ],
      },
      {
        id: 'evento', icone: '🎉', titulo: 'Primeiro evento',
        estado: (evR.count ?? 0) > 0 ? 'ok' : 'faltando',
        resumo: 'É o que destrava listas, reservas, ingressos, escala e relatórios.',
        detalhe: `${evR.count ?? 0} evento(s) cadastrado(s).`,
        passos: [
          'Aba Eventos → "Novo Evento": nome, data, horário e valores de entrada.',
          'Envie o flyer com menos de 600KB — acima disso o WhatsApp não mostra a imagem na prévia do link.',
          'Para vender ingresso, abra "Ingressos" no card do evento e crie um lote.',
        ],
      },
    ])
  }

  async function statusServidor() {
    try {
      const { data: sess } = await supabase.auth.getSession()
      const r = await fetch('/api/setup-status', {
        headers: { Authorization: `Bearer ${sess?.session?.access_token ?? ''}` },
      })
      return await r.json() as { email?: boolean; email_from?: string | null }
    } catch { return null }
  }

  if (!passos) return null

  const obrigatorios = passos.filter(p => !p.opcional)
  const prontos = obrigatorios.filter(p => p.estado === 'ok').length
  const completo = prontos === obrigatorios.length
  const pct = Math.round(prontos / obrigatorios.length * 100)

  const cor = (e: Estado) => e === 'ok' ? C.grn : e === 'parcial' ? C.gold : C.mut
  const marca = (e: Estado) => e === 'ok' ? '✓' : e === 'parcial' ? '!' : '○'

  return (
    <div style={{ background: C.card, border: `1px solid ${completo ? C.grn + '44' : C.acc + '44'}`, borderRadius: 16, padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.txt, fontSize: 16, fontWeight: 800 }}>
            {completo ? '✅ Configuração concluída' : '🚀 Primeiros passos'}
          </div>
          <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
            {completo
              ? 'Tudo pronto. Os itens opcionais abaixo ampliam o que o app faz.'
              : `${prontos} de ${obrigatorios.length} itens essenciais concluídos`}
          </div>
        </div>
        <button onClick={() => setMinimizado(m => !m)}
          style={{ background: 'none', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          {minimizado ? 'Mostrar' : 'Ocultar'}
        </button>
      </div>

      <div style={{ height: 6, background: C.bg, borderRadius: 4, overflow: 'hidden', margin: '12px 0 4px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: completo ? C.grn : C.acc, borderRadius: 4, transition: 'width .3s' }} />
      </div>

      {!minimizado && (
        <div style={{ marginTop: 12 }}>
          {passos.map(p => {
            const on = aberto === p.id
            return (
              <div key={p.id} style={{ borderTop: `1px solid ${C.brd}55` }}>
                <button onClick={() => setAberto(on ? null : p.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '11px 0', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: cor(p.estado) + '22', border: `1px solid ${cor(p.estado)}66`, color: cor(p.estado), fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {marca(p.estado)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: p.estado === 'ok' ? C.mut : C.txt, fontSize: 13.5, fontWeight: 700 }}>
                      {p.icone} {p.titulo}
                    </span>
                    {p.opcional && <span style={{ color: C.mut, fontSize: 10, marginLeft: 6 }}>opcional</span>}
                    <span style={{ display: 'block', color: C.mut, fontSize: 11, marginTop: 2 }}>{p.detalhe}</span>
                  </span>
                  <span style={{ color: C.mut, fontSize: 12, flexShrink: 0 }}>{on ? '▴' : '▾'}</span>
                </button>

                {on && (
                  <div style={{ padding: '0 0 14px 30px' }}>
                    <div style={{ color: C.sub, fontSize: 12, lineHeight: 1.6, marginBottom: 10, fontStyle: 'italic' }}>{p.resumo}</div>
                    <ol style={{ margin: 0, paddingLeft: 18, color: C.txt, fontSize: 12.5, lineHeight: 1.75 }}>
                      {p.passos.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
                    </ol>
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ borderTop: `1px solid ${C.brd}55`, paddingTop: 10, marginTop: 2 }}>
            <button onClick={carregar}
              style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              ↻ Verificar novamente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
