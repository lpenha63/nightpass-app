# Banco — como mexer sem estragar produção

Até agosto/2026 todas as migrations eram aplicadas **direto no banco de produção**, com
dados reais. Não havia ensaio. Estes arquivos existem para acabar com isso.

## O que tem aqui

`migrations/` — as 160 migrations que criaram o schema atual, exportadas do próprio
Supabase (o SQL estava guardado lá, mas não no repositório). A partir daqui, **toda
alteração de banco nasce como arquivo**, é revisada no commit e só então aplicada.

## Testar antes de aplicar (é o ponto)

Precisa de Docker e da CLI do Supabase (`npm i -g supabase`).

```bash
supabase start
```

Sobe um Postgres local e aplica todas as migrations em ordem. Se alguma quebrar, quebra
aqui — não na casa cheia numa sexta.

Para recriar do zero depois de mexer:

```bash
supabase db reset
```

## Criar uma migration nova

```bash
supabase migration new nome_curto_do_que_muda
```

Escreva o SQL no arquivo gerado, rode `supabase db reset` para provar que ele aplica
limpo desde o começo, e só então aplique em produção.

## Por que os nomes de arquivo importam

O CLI aplica em ordem alfabética, e o prefixo é a data/hora (`AAAAMMDDHHMMSS`). Nunca
renomeie um arquivo já aplicado: o Supabase guarda a lista do que já rodou pelo nome, e
renomear faz ele tentar aplicar de novo.

## O que este arranjo NÃO resolve

O preview da Vercel continua lendo o **banco de produção** — não existe banco de teste
online. Branches de banco exigem o plano Pro, e a conta já está no limite de 2 projetos
gratuitos ativos. Então:

- **mudança só de tela** → preview da Vercel resolve
- **mudança de banco** → ensaie local com `supabase start`, depois aplique em produção

Não confunda os dois: um preview verde não significa que a migration é segura.
