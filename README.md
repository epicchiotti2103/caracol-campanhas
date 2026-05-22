# Caracol Campanhas

App da suite Caracol pra **cadastrar e gerenciar campanhas**. Fonte de verdade pras campanhas usadas no NF, no Tracker e nos demais apps da suite.

Faz parte da suite Caracol — entrada pelo [Hub](https://app.aeobr.com.br).

## Status: producao

CRUD completo, backend integrado, layout de login unificado com o resto da suite. Modelo de eventos refatorado em 22/05/2026: cada evento tem `nome + payout` (numero), moeda fica na campanha. Ver `CONTEXT.md` pra evolucao.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (mesmo tema laranja escuro da suite)
- js-cookie pra sessao
- Auth via API do Tracker (`POST /api/v1/auth/login`) com SSO via cookie `.aeobr.com.br`
- **Sem backend proprio** — rotas `/api/v1/campanhas/*` vivem em `tracker-caracol/backend/app/routes/campanhas.py`

## Telas

- `/login` — split panel (layout unificado da suite)
- `/` — landing logada com atalhos pra lista e nova campanha
- `/campanhas` — lista com colunas: Codigo, Inicio, Fim, Nome, Budget, Eventos (count + tooltip com soma), Status
- `/campanhas/new` — form completo: Identificacao, Periodo, App/parceiro, Financeiro (budget + moeda BRL/USD), **Eventos (nome + payout numerico, N por campanha)**, Criativo e Observacoes
- `/campanhas/[id]` — detalhe com toggle in-place pra editar (sem rota `/edit` separada)

## Modelo de dados (campanha)

- **Codigo CMP-NNN** gerado automaticamente por trigger no Postgres (`set_campanha_codigo`)
- **Periodo** (inicio/fim), **app/parceiro**, **plataforma**, **fluxo**
- **Financeiro**: budget + moeda BRL ou USD (moeda **da campanha** — todos os payouts dos eventos usam essa moeda)
- **Eventos** (tabela filha `campanhas_eventos_pagos`): cada um com `nome + payout numeric`. Payout exibido com prefixo da moeda da campanha (`R$` / `$`). Edicao do array faz replace (PATCH manda lista nova inteira)
- **Gestores** (tabela filha `campanhas_users`): N:N com users — pra adm_campanha "ver so as suas" no futuro
- **Owner**: `campanhas.owner_id` (quem criou)

> Modelo antigo (ate 19/05) tinha `eventos_pagos` (so nome) + `campanhas_pos` (tabela paralela com numero + moeda). Refatorado em 22/05 — PO virou payout do evento. `campanhas_pos` foi dropada (migration 017).

## URLs e infra

| | |
|---|---|
| Producao | https://campanhas.aeobr.com.br |
| Vercel project | caracol-campanhas |
| DNS | Cloudflare, modo **DNS only (nuvem cinza)**, CNAME `campanhas` → `cname.vercel-dns.com` |
| Backend | `tracker-caracol/backend/app/routes/campanhas.py` |

## Como rodar (local)

```bash
cp .env.example .env.local
# preencha as variaveis (em especial NEXT_PUBLIC_SUPABASE_ANON_KEY do painel Supabase)
npm install
npm run dev
```

App em http://localhost:3000.

## Variaveis de ambiente

| Var | Descricao |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base do backend (Tracker). Ex: `https://trk.aeobr.com.br`. O config concatena `/api/v1` se faltar. |
| `NEXT_PUBLIC_HUB_URL` | URL do Hub pra "voltar" e fallbacks. Ex: `https://app.aeobr.com.br` |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase compartilhado da suite |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key do mesmo projeto (pegar no painel Supabase) |

## Deploy

Vercel detecta o repo e builda em cada push pra `main`. Dominio `campanhas.aeobr.com.br` aponta pro projeto. **Framework Preset: Next.js** (importante — `Other` quebra silenciosamente).

Configurar na Vercel as mesmas env vars do `.env.example`, com `NEXT_PUBLIC_API_URL=https://trk.aeobr.com.br`.

## Backend

Vive no Tracker — qualquer rota nova em `/api/v1/campanhas/*` e trabalho do subagente `tracker`. Repo: https://github.com/epicchiotti2103/tracker-caracol.

Endpoints principais:
- `GET /api/v1/campanhas` — lista
- `GET /api/v1/campanhas/{id}` — detalhe (com eventos como `[{id, nome, payout, ordem}]`)
- `POST /api/v1/campanhas` — cria; body aceita `eventos: [{nome, payout?}]` (payout opcional). Tambem aceita strings legadas (`["nome1"]`) por compatibilidade
- `PATCH /api/v1/campanhas/{id}` — atualiza; eventos faz replace do array
- `DELETE /api/v1/campanhas/{id}` — soft delete (status `encerrada`)
- Gestao de gestores: `POST/DELETE /api/v1/campanhas/{id}/users`

## Helpers reaproveitados

Copiados do NF/Tracker — quando a duplicacao virar dor real, vale extrair pra `@caracol/ui`:

- `lib/api.ts` (fetch com Bearer e refresh automatico)
- `lib/auth-context.tsx` (**nao editar** sem alinhar com o orquestrador — replicado em N apps)
- `lib/toast-context.tsx`
- `lib/config.ts`
- `lib/format.ts` (`formatCurrency` usando Intl.NumberFormat)
- `components/app-shell.tsx`, `components/navbar.tsx`, `components/status-badge.tsx`
