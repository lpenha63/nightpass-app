# NightPass / Upure — Resumo do Back-end

Documento para abrir/continuar o back-end em um novo projeto. Cole isto como contexto.

---

## 1. Stack & Conexão

- **Banco/Auth/Storage/Functions:** Supabase (Postgres + Auth + Edge Functions Deno)
- **Front-ends:** Vite + React + TypeScript (deploy Vercel)
- **Pagamentos:** Mercado Pago (assinaturas via *preapproval*; ingressos usam token da própria casa)

**Projeto Supabase**
- Ref: `irghwfzcbazujddfftsx`
- URL: `https://irghwfzcbazujddfftsx.supabase.co`
- Anon key (pública por design — RLS protege):
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyZ2h3ZnpjYmF6dWpkZGZmdHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjI4OTAsImV4cCI6MjA4ODEzODg5MH0.CMrdK4-7rWbgYcqttWtGF1CIWjywL0KVxYCBx27emhw`

**Apps que consomem este banco**
- **NightPass** (gestão de casas/eventos) → https://nightpass-app.vercel.app
- **Upure Admin** (central de assinaturas, multi-app) → https://upure-admin.vercel.app

---

## 2. Modelo multi-tenant

- **Tenant = `houses`** (uma casa/estabelecimento). Quase toda tabela de dado tem `house_id`.
- **Usuários:** Supabase Auth → `profiles` (1:1 com auth.users) → `house_users` (vínculo usuário↔casa com `role` e `allowed_pages`).
- **Papéis:** super_admin, admin, operador, portaria, financeiro, promoter. Permissões por página em `house_users.allowed_pages` (array). Sub-permissões por recurso via chaves tipo `events.budget`.
- **Convites:** `house_invites` (por e-mail; ao criar conta com aquele e-mail, o vínculo é ativado).

---

## 3. Tabelas por domínio

### Núcleo / tenancy
| Tabela | O que é |
|---|---|
| `houses` | Estabelecimento (tenant). Tem pix, mp_access_token (ingressos), logo, etc. |
| `profiles` | Perfil do usuário (1:1 auth.users). Campo `is_saas_admin` (dono da plataforma). |
| `house_users` | Vínculo usuário↔casa (role, allowed_pages, is_active, freelancer_id). |
| `house_invites` | Convites pendentes por e-mail. |

### Clientes & Check-in
| Tabela | O que é |
|---|---|
| `clients` | Base de clientes da casa (cpf, phone, gênero, nascimento, `birthday_wish_sent_at`). |
| `checkins` | Entradas na portaria (valor, forma de pgto, evento, cliente, promoter). |
| `checkin_types` | Tipos de entrada configuráveis (preço padrão). |

### Eventos
| Tabela | O que é |
|---|---|
| `events` | Evento (data, gênero, preços ♂/♀ e de lista, `artists` jsonb, produção, consumação, capacidade, status). |
| `event_expenses` | Despesas (kind='expense') e receitas adicionadas (kind='revenue') do budget. |
| `event_tasks` | Checklist/tarefas de produção (custo estimado/real). |
| `event_checklist_items` | Itens de checklist. |
| `event_freelancers` | Escala de equipe no evento (fee custom). |

### Listas & Reservas
| Tabela | O que é |
|---|---|
| `promoters` | Promoters da casa. Existe também um pseudo-promoter "Lista da Casa". |
| `promoter_lists` | Listas por evento (entry_fee_cents, **entry_fee_male_cents/female_cents**, consumação, token). |
| `promoter_list_guests` | Convidados da lista (is_vip, list_value_cents, confirmado, checked_in). |
| `promoter_tokens` | Tokens de portal do promoter. |
| `reservations` | Reservas de mesa/espaço (valor, sinal, tipo de lista, token, arquivamento). |
| `reservation_guests` / `reservation_items` / `reservation_types` | Convidados, itens (custo/venda) e tipos de reserva. |
| `house_spaces` | Espaços/mesas da casa. |
| `birthday_lists` / `birthday_list_guests` / `birthday_guests` | Listas de aniversário. |

### Equipe & Avaliações
| Tabela | O que é |
|---|---|
| `freelancers` | Equipe (freelancer/funcionário, áreas, diária, pix). |
| `work_areas` | Áreas de trabalho configuráveis. |
| `team_ratings` / `rating_criteria` | Avaliações da equipe pós-evento. |

### Ingressos (venda online)
| Tabela | O que é |
|---|---|
| `ticket_batches` | Lotes de ingresso (gênero, preço, qtd, vendidos). |
| `ticket_orders` | Pedidos (comprador, pagamento MP). |
| `tickets` | Ingressos individuais (token, check-in). |

### WhatsApp & Financeiro
| Tabela | O que é |
|---|---|
| `whatsapp_config` | Config Evolution API por casa (instância, url, key, ativo). |
| `whatsapp_templates` / `whatsapp_logs` | Modelos e histórico de envios. |
| `finance_entries` | Lançamentos financeiros. |

### SaaS — Assinaturas (multi-app) ⭐
| Tabela | O que é |
|---|---|
| `saas_products` | Cada app vendido (ex.: nightpass). Planos/assinaturas referenciam `product_id`. |
| `saas_plans` | Planos (key, price_cents, trial_days, **limits** jsonb, **features** jsonb, product_id). Seed: basico R$97 / profissional R$197 / premium R$297 / interno R$0. |
| `saas_subscriptions` | Assinatura viva por casa+produto. status: trialing/pending/active/past_due/suspended/canceled/comp. Campos: trial_ends_at, current_period_end, grace_until, mp_preapproval_id. |
| `saas_payments` | Pagamentos (mp_payment_id UNIQUE = idempotência). |
| `saas_webhook_events` | Eventos de webhook (auditoria/idempotência). |
| `saas_audit_log` | Ações administrativas (liberar/bloquear/trocar plano). |

**Regra de bloqueio (sem cron):** função SQL `saas_effective_status(status, trial_ends_at, grace_until)` e espelho no front (`utils/saas.ts effectiveStatus`) derivam suspensão de trial/carência vencidos em runtime.
**Trigger:** `saas_auto_trial` → casa nova ganha trial 14d no plano Profissional. Casas antigas ficaram `comp` (cortesia).

### Legado / outros apps (ignorar no NightPass)
- `establishments`, `system_users` — legado (app standalone antigo).
- `upure_*` (produtos, pedidos, leads, campanhas, kpis…) — outro app (e-commerce Upure) no mesmo banco.

---

## 4. Edge Functions (Deno)

| Função | JWT | O que faz |
|---|---|---|
| `saas-checkout` | sim | Valida admin da casa → cria assinatura (preapproval) no Mercado Pago → retorna `init_point`. Usa secret `MP_SAAS_ACCESS_TOKEN`. |
| `saas-webhook` | não | Recebe notificações do MP; **re-consulta a API do MP** (nunca confia no payload); approved→active+30d, rejected→past_due+carência 5d, cancelled→canceled. Sempre responde 200. |
| `whatsapp-send` | não | Envio avulso via Evolution API. |
| `whatsapp-birthdays` | não | Disparo de aniversário. |
| `app` | não | Função utilitária do app. |
| `reset-passwords` | não | Reset de senhas. |

---

## 5. RLS / Segurança

- RLS ligado nas tabelas SaaS e de tenant. Padrão: **membro da casa lê os próprios dados**; **saas_admin lê/gerencia tudo**; escrita de pagamentos/webhooks só via **service_role** (edge functions).
- Anon key é pública; a proteção real é a RLS. Nunca expor `service_role` no front.

---

## 6. Storage

- Buckets usados: `event-flyers` (flyers, cupons de aniversário), `client-photos` (fotos de cliente). Públicos p/ leitura via `getPublicUrl`.

---

## 7. Pendências de setup do SaaS (para cobrar de verdade)

1. Secret **`MP_SAAS_ACCESS_TOKEN`** (token do Mercado Pago da conta dona da plataforma) nas Edge Functions.
2. Webhook no painel do Mercado Pago → `https://irghwfzcbazujddfftsx.supabase.co/functions/v1/saas-webhook` (tópicos preapproval/pagamentos).

---

## 8. Convenções importantes

- **Toda coluna nova usada no código exige migration** — senão o save quebra em produção.
- Valores monetários em **centavos** (`*_cents`).
- Migrations via `apply_migration`; SQL avulso via `execute_sql`.
- Deploy NightPass: branch `feat/eventos-clientes-reservas` → `vercel deploy --prod`.
