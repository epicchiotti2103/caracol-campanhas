# Caracol Campanhas

App da suite Caracol pra **cadastrar e gerenciar campanhas**. Fonte de verdade pras campanhas usadas no NF, no Tracker e nos demais apps da suite.

Faz parte da suite Caracol — entrada pelo [Hub](https://app.aeobr.com.br).

## Status: producao

CRUD completo, backend integrado, layout de login unificado com o resto da suite. Em 26/05/2026 ganhou integracao com o robo **api_af** (AppsFlyer Pull API): novos campos `tipo`/`budget_mode`/`timezone`/`external_id` na campanha, eventos com `target_cpa`/`budget_monthly`, secoes de **Apps** e **Media sources**, alem da tela de **/desempenho** com cards por plataforma + grafico de historico. Ver `CONTEXT.md` pra evolucao.

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
- `/campanhas/new` — form completo: Identificacao, **Tipo e budget (UA/RTG, budget_mode, timezone, external_id)**, Periodo, App/parceiro, Financeiro (budget + moeda BRL/USD com mascara PT-BR), **Eventos pagos (nome + target_cpa + payout + budget_monthly condicional)**, **Apps (N plataformas android/ios)**, **Media sources (cpa/cpi)**, Criativo e Observacoes
- `/campanhas/[id]` — detalhe com toggle in-place pra editar (sem rota `/edit` separada); botao "Desempenho" leva pra `/campanhas/[id]/desempenho`
- `/campanhas/[id]/desempenho` — cards por plataforma (consolidado, android, ios) com gasto/budget + pace + fraude P360 + PA False, alem de grafico de historico (7/30/90 dias) consumindo `/api/v1/campanhas/{id}/metrics/{latest,history}`
- `/desempenho` — dashboard cross-campanha (link na navbar). Tabela com a linha consolidada (mais recente) de cada campanha: gasto/budget com barra, % MTD, pace_status, % P360 Evt, % PA False, data da ultima atualizacao. Filtros: status / tipo (UA/RTG) / pace_status (incl. "sem dados") / busca por nome/codigo. Fetch: 1 chamada a `/campanhas` + Promise.allSettled em `/{id}/metrics/latest` por campanha (opcao A; pra >20 campanhas pedir endpoint agregador no backend)

## Modelo de dados (campanha)

- **Codigo CMP-NNN** gerado automaticamente por trigger no Postgres (`set_campanha_codigo`)
- **Periodo** (inicio/fim), **app/parceiro**, **plataforma**, **fluxo**
- **Financeiro**: budget + moeda BRL ou USD (moeda **da campanha** — todos os valores monetarios dos eventos usam essa moeda)
- **api_af**: `tipo` (`ua` | `rtg`), `budget_mode` (`total` | `per_event`), `timezone`, `external_id` (= `product_name` no `config/apps.yaml` do api_af)
- **Eventos pagos** (tabela filha `campanhas_eventos_pagos`): `nome` + `payout` + `target_cpa` + `budget_monthly` (este so obrigatorio quando `budget_mode === 'per_event'`). Edicao do array faz replace (PATCH manda lista nova inteira)
- **Apps** (tabela filha `campanhas_apps`): N apps `{name, app_id, platform (android|ios), p360_enabled, only_primary_attribution, ordem}`. Replace total no PATCH
- **Media sources** (tabela filha `campanhas_media_sources`): N origens `{name, campaign_type (cpa|cpi), target_cpi?, min_installs_to_evaluate}`. Replace total no PATCH
- **Gestores** (tabela filha `campanhas_users`): N:N com users
- **Owner**: `campanhas.owner_id` (quem criou)
- **Metrics** (tabela filha `campanhas_metrics_daily`, alimentada pelo api_af): row por `(campanha_id, platform, report_date)` com `spend_actual`, `budget_monthly`, `spend_pace_pct`, `budget_used_pct`, `p360_event_rate`, `pa_false_rate`, `pace_status`

> Modelo antigo (ate 19/05) tinha `eventos_pagos` (so nome) + `campanhas_pos` (tabela paralela com numero + moeda). Refatorado em 22/05 — PO virou payout do evento. Em 26/05 evento ganhou `target_cpa` + `budget_monthly` e a campanha ganhou `tipo`/`budget_mode`/`timezone`/`external_id` + filhas `campanhas_apps` e `campanhas_media_sources`.

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
- `GET /api/v1/campanhas` — lista (cada item ja inclui `eventos_pagos`, `apps`, `media_sources`)
- `GET /api/v1/campanhas/{id}` — detalhe completo
- `POST /api/v1/campanhas` — cria. Body: campos da campanha + `eventos_pagos: [{nome, payout?, target_cpa?, budget_monthly?}]` + `apps: [{name, app_id, platform, p360_enabled, only_primary_attribution, ordem}]` + `media_sources: [{name, campaign_type, target_cpi?, min_installs_to_evaluate, ordem}]`
- `PATCH /api/v1/campanhas/{id}` — atualiza; arrays (`eventos_pagos`/`apps`/`media_sources`) fazem replace total quando enviados
- `DELETE /api/v1/campanhas/{id}` — soft delete (status `encerrada`)
- `GET /api/v1/campanhas/{id}/metrics/latest` — snapshot mais recente por plataforma (`android`/`ios`/`consolidado`)
- `GET /api/v1/campanhas/{id}/metrics/history?days=N` — serie diaria (default 30, max 180). Usada pelo grafico de /desempenho
- Gestao de gestores: `GET/PUT /api/v1/campanhas/{id}/users`

## Helpers reaproveitados

Copiados do NF/Tracker — quando a duplicacao virar dor real, vale extrair pra `@caracol/ui`:

- `lib/api.ts` (fetch com Bearer e refresh automatico)
- `lib/auth-context.tsx` (**nao editar** sem alinhar com o orquestrador — replicado em N apps)
- `lib/toast-context.tsx`
- `lib/config.ts`
- `lib/format.ts` (`formatCurrency` + helpers PT-BR `formatNumberPtBr`/`parseNumberPtBr`/`blurFormatNumberPtBr`/`sanitizeNumberInput` usados nos inputs monetarios pra aceitar virgula)
- `lib/pace.ts` (helpers de cor/badge pro `pace_status` e taxas de fraude — usado pelas duas telas de desempenho)
- `components/app-shell.tsx`, `components/navbar.tsx`, `components/status-badge.tsx`
