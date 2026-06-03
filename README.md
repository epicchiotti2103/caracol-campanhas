# Caracol Campanhas

App da suite Caracol pra **cadastrar e gerenciar campanhas**. Fonte de verdade pras campanhas usadas no NF, no Tracker e nos demais apps da suite.

Faz parte da suite Caracol — entrada pelo [Hub](https://app.aeobr.com.br).

## Status: producao

CRUD completo, backend integrado, layout de login unificado com o resto da suite. Em 26/05/2026 ganhou integracao com o robo **api_af** (AppsFlyer Pull API): novos campos `tipo`/`budget_mode`/`timezone`/`external_id` na campanha, eventos com `target_cpa`/`budget_monthly`, secoes de **Apps** e **Publishers**, alem da tela de **/desempenho** com cards por plataforma. Em 02/06/2026 o modelo de media sources virou **Publishers**: cada publisher tem suas media sources (strings) + **PO (payout) por evento** — o payout saiu do evento (que agora so tem `target_cpa`/`budget_monthly`). Ver `CONTEXT.md` pra evolucao.

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
- `/campanhas/new` — form completo: Identificacao, **Tipo e budget (UA/RTG, budget_mode, timezone, external_id)**, Periodo, App/parceiro, Financeiro (budget + moeda BRL/USD com mascara PT-BR), **Eventos pagos (nome + target_cpa + budget_monthly condicional)**, **Apps (N plataformas android/ios)**, **Publishers (nome + media sources dinamicas + PO/payout por evento, reconciliado por `evento_nome`)**, Criativo e Observacoes
- `/campanhas/[id]` — detalhe com toggle in-place pra editar (sem rota `/edit` separada); botao "Desempenho" leva pra `/campanhas/[id]/desempenho`
- `/campanhas/[id]/desempenho` — cards por plataforma (consolidado, android, ios) com gasto/budget + pace + fraude P360 + PA False, alem de grafico de historico (7/30/90 dias) consumindo `/api/v1/campanhas/{id}/metrics/{latest,history}`
- `/desempenho` — dashboard cross-campanha (link na navbar). Tabela com a linha consolidada (mais recente) de cada campanha: gasto/budget com barra, % MTD, pace_status, % P360 Evt, % PA False, data da ultima atualizacao. Filtros: status / tipo (UA/RTG) / pace_status (incl. "sem dados") / busca por nome/codigo. Fetch: 1 chamada a `/campanhas` + Promise.allSettled em `/{id}/metrics/latest` por campanha (opcao A; pra >20 campanhas pedir endpoint agregador no backend)

## Modelo de dados (campanha)

- **Codigo CMP-NNN** gerado automaticamente por trigger no Postgres (`set_campanha_codigo`)
- **Periodo** (inicio/fim), **app/parceiro**, **plataforma**, **fluxo**
- **Financeiro**: budget + moeda BRL ou USD (moeda **da campanha** — todos os valores monetarios dos eventos usam essa moeda)
- **api_af**: `tipo` (`ua` | `rtg`), `budget_mode` (`total` | `per_event`), `timezone`, `external_id` (= `product_name` no `config/apps.yaml` do api_af), `mmp` (`appsflyer` | `adjust`)
- **Parceria Wave** (`parceria_wave`, default false): se Sim, a campanha entra no relatorio AppsFlyer enviado pro parceiro Wavesync (cron seg/qua/sex do api_af, `--only-wave`). Coluna "Wave" (Sim/Nao) na lista. Default Nao = nao vaza pro parceiro sem marcar
- **Coleta de dados** (`coleta_manual`, default false): `Manual` tira a campanha do `apps.yaml` (robo nao busca) e libera o form "Inserir metrics manualmente" mesmo em `mmp=appsflyer` (ex: campanha de parceiro so com input manual). O backend auto-calcula `spend_pace_pct`/`budget_used_pct` no `/metrics/manual` a partir do budget da campanha
- **Eventos pagos** (tabela filha `campanhas_eventos_pagos`): `nome` + `target_cpa` (= PO/CPA contratado pelo cliente) + `budget_monthly` (este so obrigatorio quando `budget_mode === 'per_event'`). **Sem payout** — o payout virou propriedade do publisher. Edicao do array faz replace (PATCH manda lista nova inteira)
- **Apps** (tabela filha `campanhas_apps`): N apps `{name, app_id, platform (android|ios), p360_enabled, only_primary_attribution, ordem}`. Replace total no PATCH
- **Publishers** (filhas `campanhas_publishers` + `campanhas_publisher_media_sources` + `campanhas_publisher_payouts`): cada publisher `{nome, media_sources, payouts: [{evento_nome, payout}], moeda, ordem}`. Em **LEITURA** as media sources vem como objetos `{id, name, active, deactivated_reason, deactivated_at, deactivated_registered_at}` (cada PID pode ser ativada/desativada com justificativa + `deactivated_at` = data EFETIVA da pausa, editavel/default hoje + `deactivated_registered_at` = registro automatico now(), read-only); em **GRAVACAO** (POST/PATCH) manda-se `string[]` de nomes — o backend reconcilia o estado (`active`/`reason`/`data`) por nome, entao editar a campanha nao zera os toggles. O payout (PO/repasse) e por evento, keyado por `evento_nome` (sobrevive ao replace dos eventos). A `moeda` (`BRL`/`USD`, default `USD`) e **por publisher** e aplica a todos os POs dele — independente da moeda da campanha. Replace total no PATCH. O toggle de media source NAO passa pelo form: vai por endpoint dedicado (ver abaixo), so na tela de detalhe
- **Gestores** (tabela filha `campanhas_users`): N:N com users
- **Owner**: `campanhas.owner_id` (quem criou)
- **Metrics** (tabela filha `campanhas_metrics_daily`, alimentada pelo api_af): row por `(campanha_id, platform, report_date)` com `spend_actual`, `budget_monthly`, `spend_pace_pct`, `budget_used_pct`, `p360_event_rate`, `pa_false_rate`, `pace_status`

> Modelo antigo (ate 19/05) tinha `eventos_pagos` (so nome) + `campanhas_pos` (tabela paralela com numero + moeda). Refatorado em 22/05 — PO virou payout do evento. Em 26/05 evento ganhou `target_cpa` + `budget_monthly` e a campanha ganhou `tipo`/`budget_mode`/`timezone`/`external_id` + filhas `campanhas_apps` e `campanhas_media_sources`. Em 01/06 ganhou `parceria_wave` (relatorio Wavesync) e `coleta_manual` (fora do robo + input manual). Em 02/06 `campanhas_media_sources` foi substituida por **Publishers** (`campanhas_publishers` + media sources/payouts filhos): o `payout` saiu do evento e virou PO por evento dentro de cada publisher.

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
- `GET /api/v1/campanhas` — lista (cada item inclui `eventos_pagos`; **nao** traz `apps`/`publishers` — payload morto na listagem, so no detalhe)
- `GET /api/v1/campanhas/{id}` — detalhe completo (inclui `apps` + `publishers` + `paused_at`/`paused_registered_at`/`paused_reason`)
- `GET /api/v1/campanhas/{id}/publishers` — `{items, total}` dos publishers (substituiu o removido `/{id}/media-sources`). Cada media source vem como `{id, name, active, deactivated_reason, deactivated_at, deactivated_registered_at}`
- `PATCH /api/v1/campanhas/publishers/media-sources/{ms_id}` — ativa/desativa uma media source (PID). Body `{active, reason?, deactivated_at?}`: desativar EXIGE `reason` (400 se vazio) e aceita `deactivated_at` (data efetiva da pausa em ISO `YYYY-MM-DD`; se omitido o backend usa hoje), o `deactivated_registered_at` e gravado automaticamente (now()); reativar limpa `reason`+ambas as datas. Usado pelo toggle na tela de detalhe (modal de justificativa obrigatoria + campo data da pausa)
- `POST /api/v1/campanhas` — cria. Body: campos da campanha + `eventos_pagos: [{nome, target_cpa?, budget_monthly?}]` + `apps: [{name, app_id, platform, p360_enabled, only_primary_attribution, ordem}]` + `publishers: [{nome, media_sources: [str], payouts: [{evento_nome, payout}], moeda}]` (`moeda` BRL/USD, default USD)
- `PATCH /api/v1/campanhas/{id}` — atualiza; arrays (`eventos_pagos`/`apps`/`publishers`) fazem replace total quando enviados
- `POST /api/v1/campanhas/{id}/pause` — pausa a campanha inteira (status → `pausada`). Body `{reason, paused_at?}` (`paused_at` = data efetiva ISO `YYYY-MM-DD`, default hoje; `paused_registered_at` gravado automatico). Botao "Pausar campanha" no detalhe abre modal motivo+data (`ReasonDateModal`)
- `POST /api/v1/campanhas/{id}/unpause` — reativa (status → `ativa`), limpa os 3 campos de pausa. Botao "Reativar campanha" no detalhe
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
- `lib/cache.ts` (**proprio do Campanhas**, nao replicado): `cachedFetch`/`invalidateCache` — camada de cache+dedupe LOCAL por cima do `apiFetch` (sem tocar no `apiFetch` compartilhado). Dedupa GETs in-flight iguais e cacheia por TTL em memoria de sessao; `months_available` usa TTL longo. Usado no boot pra cortar requests repetidas (`/hub/me/apps`, `months_available`, lista).
- `components/app-shell.tsx`, `components/navbar.tsx`, `components/status-badge.tsx`
