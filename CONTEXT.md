# Caracol Campanhas — contexto detalhado

> Doc de arquitetura e decisoes. Resumo executivo em `README.md`.

## O que e

App da suite Caracol pra **cadastrar e gerenciar campanhas**. Substitui (no futuro) o campo `campaign` texto livre do NF: quando pronto, NF passa a referenciar `campanhas.id` via FK. Pode evoluir pra ser fonte de verdade pra outras dimensoes (afiliados, ofertas) se fizer sentido.

**Estado atual: producao** — CRUD funcional, integrado ao backend do Tracker, com tela de desempenho consumindo metrics do robo api_af (AppsFlyer Pull API).

## URLs e infra

| | |
|---|---|
| Repo | https://github.com/epicchiotti2103/caracol-campanhas (a criar) |
| Producao | https://campanhas.aeobr.com.br (a configurar) |
| Vercel project | caracol-campanhas (a criar) |
| DNS | Cloudflare, modo **DNS only (nuvem cinza)**, CNAME `campanhas` → `cname.vercel-dns.com` |
| HTTPS | Let's Encrypt via Vercel automatico |
| Backend | `tracker-caracol/backend/app/routes/campanhas.py` (a criar pelo subagente `tracker`) |

## Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS (tema laranja escuro, igual NF/Tracker — mesmas variaveis HSL)
- js-cookie pra sessao
- lucide-react pra icones
- Auth: chama `POST /api/v1/auth/login` do backend do Tracker (Supabase Auth via FastAPI)
- **Sem backend proprio.** Rotas `/api/v1/campanhas/*` vivem no Tracker.

## Estrutura de pastas

```
caracol-campanhas/
  app/
    globals.css                  Variaveis HSL do tema
    layout.tsx                   AuthProvider + ToastProvider
    page.tsx                     Landing logada com atalhos
    login/page.tsx               Login (compartilha SSO com a suite)
    campanhas/
      page.tsx                   Lista de campanhas (tolera 404)
      new/page.tsx               Form de criacao (so usa <CampanhaForm />)
      [id]/page.tsx              Detalhe com toggle in-place pra editar
      [id]/desempenho/page.tsx   Cards por plataforma + grafico de historico (api_af)
    desempenho/
      page.tsx                   Dashboard cross-campanha (KPIs consolidados de TODAS)
  components/
    app-shell.tsx                Layout com navbar
    bootstrap-gate.tsx           Gate de acesso via /hub/me/apps (nao bloqueia o shell — checa em background; so toma a tela em no-app/error)
    campanha-form.tsx            Form unico usado em new e edicao inline
    navbar.tsx                   Navbar com logo do Hub e nav de campanhas
    status-badge.tsx             Badge de status da campanha
  lib/
    api.ts                       fetch helper com Bearer + refresh automatico (REPLICADO nos N apps — nao editar)
    auth-context.tsx             Sessao + SSO (REPLICADO nos N apps)
    cache.ts                     Cache/dedupe LOCAL por cima do apiFetch (cachedFetch/invalidateCache) — perf de boot
    config.ts                    API_BASE_URL, HUB_URL
    format.ts                    formatCurrency + mascara PT-BR (virgula decimal)
    pace.ts                      Helpers de cor/badge pro pace_status + taxas de fraude
    toast-context.tsx            Toasts globais
  types/index.ts                 Campanha, CampanhaEvento, CampanhaApp, CampanhaMediaSource, CampanhaMetrics*
  middleware.ts                  Redireciona pra /login se nao autenticado
  public/logo-caracol.png        Logo da suite
```

## Endpoints (consumidos quando o backend chegar)

Todos sob `NEXT_PUBLIC_API_URL` (`https://trk.aeobr.com.br`, com `/api/v1` concatenado pelo `lib/config.ts`):

- `POST /auth/login` — login (mesmo do Hub/NF/Tracker)
- `POST /auth/refresh` — refresh do token (transparente via `lib/api.ts`)
- `GET /campanhas` — lista (filtrada por permissao no backend; resposta `{items: Campanha[]}` ou array direto — frontend aceita os dois)
- `GET /campanhas/{id}` — detalhe
- `POST /campanhas` — cria `{name, slug?, status?}` → retorna `{id, ...}`
- `PUT /campanhas/{id}` — atualiza (fase 2)
- `DELETE /campanhas/{id}` — remove (fase 2, opcional)
- `GET /campanhas/{id}/users` — gestores (fase 2)
- `PUT /campanhas/{id}/users/{user_id}` — atribuir gestor (fase 2)
- `GET /perms/campanhas/me` — `{app, role, permissions:[keys]}` do usuario logado (RBAC dinamico, fase 4.7)
- `GET /perms/campanhas/matrix` (admin) — `{roles, catalog:[{key,label,group}], matrix:{role:{key:bool}}}`
- `PUT /perms/campanhas/matrix` (admin) — body `{matrix:{role:{key:bool}}}`

A lista chama `GET /campanhas` em modo tolerante: 404 e "failed to fetch" sao silenciados pra permitir o app rodar enquanto o backend nao existe.

## Schema (proposta — confirmar antes de migrar)

Tabela `campanhas` no mesmo Supabase da suite (`vdjecbkmukjurhyvprug`). **Sem prefixo** — campanhas e dominio compartilhado, nao "feature do NF".

```sql
create table campanhas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text unique,
  status text not null default 'ativa' check (status in ('ativa', 'pausada', 'encerrada')),
  owner_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table campanhas_users (
  campanha_id uuid not null references campanhas(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'gestor' check (role in ('gestor')),
  primary key (campanha_id, user_id)
);
```

Quando NF migrar pra referenciar campanhas: adiciona `nf_invoices.campanha_id uuid references campanhas(id)` (opcional inicialmente, depois NOT NULL). Backfill com base no texto livre atual.

> **Estado real (a tabela evoluiu muito alem dessa proposta).** `campanhas` ganhou: `codigo` (CMP-NNN via trigger), `inicio`/`fim`, `app`/`af_prt`/`plataforma`/`fluxo`/`criativo`/`obs`, `budget`/`moeda`, `tipo` (ua|rtg), `budget_mode` (total|per_event|per_platform — no per_platform cada `campanhas_apps` tem `budget_monthly` obrigatorio > 0 e o budget total da campanha nao se aplica), `timezone`, `external_id`, `mes_referencia` (snapshot mensal — cada mes e 1 linha), `mmp` (appsflyer|adjust), **`parceria_wave`** (default false — relatorio Wavesync via `--only-wave` do api_af) e **`coleta_manual`** (default false — tira do `apps.yaml`/robo e libera input manual mesmo em appsflyer). Filhas: `campanhas_eventos_pagos` (sem payout — so `nome`/`target_cpa`/`budget_monthly`), `campanhas_apps`, **`campanhas_publishers`** (com `moeda` BRL/USD default USD — por publisher, aplica a todos os POs dele; + filhas `campanhas_publisher_media_sources` e `campanhas_publisher_payouts`, esta keyada por `evento_nome`), `campanhas_metrics_daily`, `campanhas_metrics_publishers_daily`, `campanhas_fechamento_mensal`, `campanhas_fechamento_publishers`. Migrations no `tracker-caracol/backend/migrations/` (campanhas: 015-024, 027, 029, 030, + a de publishers commit 8a07815). A antiga `campanhas_media_sources` foi substituida por Publishers em 02/06 (payout saiu do evento e virou PO por evento dentro de cada publisher).

## Auth e SSO

Mesmo cookie no dominio raiz `.aeobr.com.br` (igual Hub, NF, Tracker). Em producao, login feito em qualquer app da suite vale aqui. Em dev (`localhost`), sem cross-subdomain.

### Regra critica

`lib/auth-context.tsx` e **identico** ao do Hub, NF e Tracker — qualquer mudanca tem que ser replicada nos N apps simultaneamente ou SSO quebra. Esse arquivo so muda via tarefa do orquestrador, nunca por iniciativa do subagente `campanhas`.

### Controle de admin

- `useAuth().isAdmin` vem direto de `user.hub_role === "admin"`. Sem lista hardcoded de emails.
- Em client components, usar `const { isAdmin } = useAuth()`.
- Em middleware, ler cookie `user_data` e checar `hub_role === "admin"`.

### RBAC dinamico (Fase 4.7)

Acima do `isAdmin` binario, a UI gateia acoes por **permissoes dinamicas por papel**, carregadas no bootstrap.

- **`lib/perms-context.tsx`** (`PermsProvider` no `app/layout.tsx`, dentro do `AuthProvider`): no boot chama `GET /perms/campanhas/me` → `{role, permissions:[keys]}` e expoe `usePerms()` / `useCan()` com helper `can(key)`. **admin sempre retorna true** (god-mode). NAO mexe em `auth-context.tsx` (replicado nos 5 apps).
- **Keys**: `campanhas.view_all`, `campanhas.create`, `campanhas.edit`, `campanhas.delete`, `campanhas.metrics_manual`.
- **Graceful degradation**: se `/perms/campanhas/me` falhar (backend fora do ar), fallback derivado do `hub_role` — `admin` ve tudo; `campanha` = view_all+create+edit (sem delete, sem metrics_manual); outros = nada (o `BootstrapGate` ja barra quem nao tem o app).
- **Gating na UI** (substitui checks `isAdmin` hardcoded): criar/duplicar campanha → `create`; editar / pausar / despausar / toggle media source / fechamento mensal → `edit`; inserir metrics manual (modal Adjust/coleta_manual) → `metrics_manual`; deletar → `delete` (botao "Excluir" no header do detalhe + acao de lixeira por item na lista, ambos gateados por `can("campanhas.delete")`, com modal de confirmacao destrutiva; chama `DELETE /api/v1/campanhas/{id}` e invalida o cache da lista). A **lista** nao e mais escondida por `isAdmin` — `campanha` ve todas (backend resolve via `view_all`).
- **Tela admin `app/admin/papeis/page.tsx`** (admin-only, item "Papeis" na navbar so pra admin): grade papel×permissao consumindo `GET /perms/campanhas/matrix` → `{roles, catalog:[{key,label,group}], matrix:{role:{key:bool}}}` e salvando via `PUT /perms/campanhas/matrix` body `{matrix}`. Coluna `admin` e read-only (god-mode); demais papeis editaveis por toggle.

### Acesso ao app

Diferente do NF, **nao tem `BootstrapGate`** neste scaffold inicial. Quem chega autenticado entra. Quando o gate de `/hub/me/apps` (slug `campanhas`) for adicionado, replicar o padrao do `caracol-nf/components/nf/bootstrap-gate.tsx`.

## Variaveis de ambiente

```
NEXT_PUBLIC_API_URL=https://trk.aeobr.com.br
NEXT_PUBLIC_HUB_URL=https://app.aeobr.com.br
NEXT_PUBLIC_SUPABASE_URL=https://vdjecbkmukjurhyvprug.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=(painel Supabase)
```

`lib/config.ts` concatena `/api/v1` no `NEXT_PUBLIC_API_URL` automaticamente se faltar.

## Roadmap

- [x] **Fase 0 — scaffold**: clonar estrutura do NF, telas placeholder, login, README + CONTEXT
- [x] **Fase 1 — backend** (tracker): rotas CRUD `/api/v1/campanhas/*`, migrations das tabelas `campanhas`, `campanhas_users`, `campanhas_eventos_pagos`
- [x] **Fase 2 — frontend funcional**: lista, edicao inline, atribuir gestores, codigo CMP-NNN
- [x] **Fase 3 — payout no evento** (22/05): drop `campanhas_pos`, payout vira propriedade do evento
- [x] **Fase 4 — api_af integration** (26/05): novos campos `tipo`/`budget_mode`/`timezone`/`external_id`, tabelas `campanhas_apps`/`campanhas_media_sources`/`campanhas_metrics_daily`, eventos ganham `target_cpa`/`budget_monthly`, tela `/campanhas/[id]/desempenho`
- [x] **Fase 4.1 — dashboard cross-campanha** (26/05): rota `/desempenho` listando todas as campanhas com KPIs consolidados (gasto/budget, % MTD, pace, P360, PA False); link "Desempenho" na navbar
- [x] **Fase 4.2 — Publishers + PO por evento** (02/06): media sources viraram **Publishers** (cada um com media sources strings + PO/payout por evento, keyado por `evento_nome`); payout saiu do evento. Form, detalhe, lista e modal de fechamento adaptados; fechamento exibe `publishers_cadastrados` (PO acordado, casado por nome) como referencia ao lado do realizado. Endpoint antigo `/{id}/media-sources` removido → `/{id}/publishers`
- [x] **Fase 4.3 — moeda por publisher** (02/06): `campanhas_publishers` ganhou `moeda` (`BRL`/`USD`, default `USD`) — backend commit c656825. A moeda e **por publisher** (aplica a todos os POs dele), independente da moeda da campanha. Form ganhou select R$/U$ por publisher (default USD ao adicionar); detalhe e modal de fechamento (PO acordado) formatam cada PO na moeda do publisher. `publishers_cadastrados` do fechamento tambem inclui `moeda`
- [x] **Fase 4.4 — ativar/desativar media source (PID)** (02/06): `campanhas_publisher_media_sources` ganhou `active`/`deactivated_reason`/`deactivated_at` (backend commit 61229a7). O shape de `media_sources` em LEITURA virou `[{id, name, active, deactivated_reason, deactivated_at}]` (era `[string]`). Toggle via `PATCH /api/v1/campanhas/publishers/media-sources/{ms_id}` body `{active, reason?}` — desativar EXIGE `reason` (400 se vazio), reativar limpa reason+data. No detalhe (`PublishersTable`) cada media source mostra estado (ativa = chip + "Desativar"; inativa = riscado + justificativa + data + "Reativar"); desativar abre modal com justificativa obrigatoria; recarrega o detalhe apos toggle. No SAVE do form ainda manda `string[]` de nomes (backend reconcilia o estado por nome); o form extrai `.name` na leitura. Fechamento destaca media sources inativas (badge + justificativa + data) no `publishers_cadastrados`
- [x] **Fase 4.5 — duas datas na pausa de media source** (02/06): backend (commit 8c7af37) separou `deactivated_at` = data EFETIVA da pausa (informada pelo user, default hoje) de `deactivated_registered_at` = registro automatico now() (read-only). Shape de `media_sources` ganhou `deactivated_registered_at`. `PATCH .../media-sources/{ms_id}` aceita `{active, reason?, deactivated_at?}` (ISO `YYYY-MM-DD`; se omitido usa hoje). Front: `DeactivateMediaSourceModal` ganhou campo "Data da pausa" (`input type=date`, default hoje, editavel) + texto "Registrado automaticamente na data de hoje"; envia `deactivated_at`. Exibicao das inativas (form, `PublishersTable`, fechamento) mostra "Pausado em {efetiva}" + "(registrado em {registered_at})" em texto menor; tolera registered_at null (dados antigos)
- [x] **Fase 4.6 — pausar/reativar campanha inteira** (02/06): backend (commit 3dccb46) ganhou `campanhas.paused_at`/`paused_registered_at`/`paused_reason` + endpoints `POST /api/v1/campanhas/{id}/pause` (body `{reason, paused_at?}` → status `pausada`) e `POST /{id}/unpause` (volta `ativa`). GET detalhe/listagem retornam os 3 campos; fechamento GET retorna `campanha_paused` (bool) + os 3 campos. Front: botao **"Pausar campanha"** (status != pausada) / **"Reativar campanha"** (pausada) no header do detalhe; pausar abre `ReasonDateModal` (motivo select Fraude/Budget/Outro + data da pausa) e chama `/pause`, reativar chama `/unpause`. Aviso destacado "Campanha pausada em {paused_at} — {paused_reason} (registrado em {paused_registered_at})" quando pausada. Modal de fechamento mostra aviso "⚠ Campanha inteira foi pausada..." no topo quando `campanha_paused`. Logica motivo+data extraida pra `components/reason-date-modal.tsx` (DRY com `DeactivateMediaSourceModal`, que virou wrapper fino)
- [x] **Fase 4.7 — RBAC dinamico** (08/06): permissoes por papel carregadas no boot via `GET /perms/campanhas/me` (`lib/perms-context.tsx` → `useCan()`); UI gateada por `can(...)` em vez de `isAdmin` (create/edit/delete/metrics_manual); papel `campanha` agora ve a lista toda (backend resolve via `view_all`) e nao e mais barrado pelo gate; tela admin `app/admin/papeis` (grade papel×permissao, `GET`/`PUT /perms/campanhas/matrix`) + item "Papeis" na navbar admin. Graceful degradation com fallback por `hub_role` se o backend de perms estiver fora. **Backend (rotas `/perms/campanhas/*`) e job do subagente `tracker`.**
- [x] **Fase 4.8 — historico de renegociacao do payout** (09/06): cada item de `publishers_cadastrados` (no GET do fechamento) ganhou campo opcional `renegociacoes: [{evento_nome, payout_anterior, payout_novo, changed_at}]` (ordenado por `changed_at`; `[]`/ausente quando nao houve). No modal de fechamento, a coluna "PO acordado" mostra, ao lado do payout atual de cada evento, um indicador ambar discreto "(era {payout_anterior} · {dd/mês})" usando a renegociacao mais recente daquele evento; tooltip (`title`) traz a cadeia completa quando ha multiplas. Casa renegociacao por `evento_nome` (case-insensitive); moeda = do publisher cadastrado. Graceful: campo ausente vira `[]`, nao quebra. Tipo novo `CampanhaPublisherRenegociacao` em `types/index.ts`. **Backend (slug `payout-renegociacao-historico`) e job do subagente `tracker`.**
- [x] **Fase 4.9 — renegociacao no detalhe da campanha** (09/06): o GET do detalhe (`GET /api/v1/campanhas/{id}`) passou a incluir, em cada publisher, o mesmo `renegociacoes: [{evento_nome, payout_anterior, payout_novo, changed_at}]` (ordenado por `changed_at` ASC; `[]`/ausente = nada). No `PublishersTable` do detalhe (`app/campanhas/[id]/page.tsx`), a coluna "Payout" da secao "PO por evento" agora mostra ao lado do payout atual o mesmo indicador ambar "(era {payout_anterior} · {dd/mês})" usando a renegociacao mais recente do evento (tooltip com a cadeia completa quando ha multiplas). Casa por `evento_nome` (case-insensitive); moeda = do publisher; graceful (campo ausente vira `[]`). `CampanhaPublisher` ganhou `renegociacoes?: CampanhaPublisherRenegociacao[]`. Helper local `fmtDateShort` espelha o do `campanha-fechamento-modal.tsx`. **Backend (slug `payout-renegociacao-detalhe`) e job do subagente `tracker`.**
- [x] **Fase 4.10 — lista "planilhao"** (09/06): a tabela de `/campanhas` (`app/campanhas/page.tsx`) virou densa (padding `py-2.5`, fonte `text-xs`, `align-top`) pra resumir a campanha sem abrir. Colunas: Codigo, Mes, Inicio, Fim, Campanha, **Budget** (numero PT-BR sem simbolo via `formatNumberPtBr`), **Moeda** (R$/U$ em coluna propria), **Evento pago** (nomes dos `eventos_pagos` empilhados, 1 linha por evento), **PO** (`target_cpa` de cada evento empilhado e alinhado linha-a-linha com Evento pago; ausente = "—"), **Plataforma** (`mmp` capitalizado: Appsflyer/Adjust), Status, Wave. Substituiu a antiga coluna unica "Eventos" (count + tooltip). Tudo so frontend — o list enrich do backend ja mandava `eventos_pagos`/`mmp`/`moeda`/`parceria_wave`. Scroll horizontal pelo `overflow-x-auto` ja existente no container. Busca/filtros de status/seletor de mes intactos. Helpers locais novos: `fmtBudgetNumber`, `fmtMoedaShort`, `fmtMmp`, `renderEventoCol`, `renderPoCol` (removidos `fmtBudget`/`summarizeEventosCount`/`eventosTooltip`).
- [x] **Fase 4.11 — moeda de pagamento por publisher no fechamento** (16/06): cada linha de publisher no fechamento (`campanha-fechamento-modal.tsx`) ganhou **moeda de PAGAMENTO propria** (select USD/BRL, default USD), independente da moeda de RECEBIMENTO (campanha). `FechamentoPublisher` e `FechamentoUpsertPayload.publishers[]` ganharam `moeda?: Moeda` (`types/index.ts`); `PublisherRow` ganhou `moeda` (default USD em `toRow`/`addPub`/mapeamento de stub). Coluna "Spend final" virou **"Pagamento"** (prefixo da moeda do pub ao lado do input, nao mais o da campanha) + nova coluna **"Moeda"** (select por linha). A "Soma" deixou de ser numero unico: agrupa por moeda (`publishersSumByMoeda` → label tipo "$ 1.000,00 + R$ 500,00", USD primeiro). O aviso de mismatch (soma x spend final da campanha) so aparece quando TODOS os pubs pagam na moeda do recebimento (`sumComparable`); com moedas mistas/distintas e suavizado/oculto (nunca bloqueia salvamento). O POST upsert envia `moeda` de cada pub. **Backend (slug `fechamento-moeda-por-publisher`) e job do subagente `tracker`** — coluna `moeda text not null default 'USD'` na tabela de publishers do fechamento; GET retorna `moeda` por pub, POST aceita (default USD se ausente).
- [x] **Fase 4.12 — cap de eventos por publisher** (18/06): cada publisher pode ter um **cap** de entrega: tipo **nenhum/mensal/diario** (nunca os dois), unidade **eventos** ou **US$**, valor + vigencia (inicio/fim opcional). Cap diario corta dia-a-dia sem netting; mensal no acumulado do mes. No `components/campanha-form.tsx` cada publisher ganhou um bloco "Cap de eventos" (`CapBlock`); ao editar uma campanha com cap ja vigente e mudar tipo/unidade/valor, abre `CapEffectiveDateModal` (so data) pedindo a **data efetiva** da renegociacao (vira nova vigencia; padrao espelhado do `ReasonDateModal`). Serie de vigencias mostrada read-only (`caps_historico`). No `components/campanha-fechamento-modal.tsx`, publishers com cap ganharam o bloco `CapExcedenteBlock`: **Realizado / Valido / Excedente desconsiderado** + breakdown expansivel (`cap_breakdown` por periodo de vigencia) + toggle **"Pagar excedente mesmo assim"** (`excedente_aprovado` no payload; ao ligar o spend_final exibido volta pro cheio `realizado_spend`, ao desligar volta pro `spend_valido`). Publisher sem cap nao muda nada. Tipos novos em `types/index.ts`: `CampanhaCapTipo`/`CampanhaCapUnidade`/`CampanhaPublisherCap`/`CampanhaCapHistorico`/`CapBreakdownPeriodo`; `CampanhaPublisher` ganhou `cap?`+`caps_historico?`; `FechamentoPublisher` ganhou `realizado_qty/realizado_spend/cap_tipo/cap_unidade/valido_qty/excedente_qty/spend_valido/spend_excedente/excedente_aprovado/cap_breakdown`; `FechamentoUpsertPayload.publishers[]` ganhou `excedente_aprovado?`. **Backend (slug `cap-eventos-publisher`) e job do subagente `tracker`** — schema do cap + vigencias + calculo de valido/excedente no GET do fechamento. Frontend implementado contra o contrato provavel do inbox; confirmar shape exato quando o tracker reportar.
- [x] **Fase 4.13 — historico de pausa/reativacao (status-windows)** (25/06): a **reativacao** da campanha agora pede DATA EFETIVA (antes nao pedia nada). O botao "Reativar campanha" abre o `DateOnlyModal` (so data, default hoje — espelha o `ReasonDateModal` sem o campo de motivo) e o `POST /campanhas/{id}/unpause` passou a enviar body `{ effective_at: "YYYY-MM-DD" }`. O detalhe (`app/campanhas/[id]/page.tsx`) ganhou a secao **"Historico de pausa (mes de referencia)"** que lista as janelas do mes ("Pausada de DD/MM ate DD/MM", ou "ate o fim do mes" se segue pausada) com o cabecalho "X de Y dias ativos no mes" (`PauseWindowsView`). Janela e `[inicio, fim)` — o dia da reativacao ja conta como ativo; o endpoint NAO traz motivo. As janelas vem do helper isolado `lib/pause-windows.ts` (`fetchStatusWindows`, `GET /campanhas/{id}/status-windows?month=YYYY-MM` — `month` derivado do `mes_referencia`), tolerante a backend ausente (404/rede -> null, secao some). Tipos em `types/index.ts`: `CampanhaPauseWindow` (`{inicio, fim|null}`) + `CampanhaStatusWindowsResponse` (`{dias_ativos, dias_no_mes, pausas[]}`). Componente novo `components/date-only-modal.tsx`. O mesmo objeto `status_windows` tambem vem no GET do fechamento. **Backend (slug `campanhas-pause-log`) e job do subagente `tracker`** — ja implementado e em producao; contrato real confirmado.
- [x] **Fase 4.14 — exclusao por pausa no fechamento** (25/06): o backend (tracker, commit 8437d46) passou a DESCONTAR no fechamento as conversoes que cairam em dias pausados — `spend_final`/`spend_real`/`installs_or_conversions` ja vem LIQUIDOS. Cada item de `publishers[]` do GET/POST do fechamento ganhou `pausa_aplicada` (bool), `realizado_qty_bruto` (int, antes da exclusao), `qty_excluida_pausa` (int), `spend_excluida_pausa` (float); o objeto do fechamento ganhou `status_windows` (mesmo shape do `/status-windows`). No `components/campanha-fechamento-modal.tsx`, abaixo do nome de cada publisher, o `PausaExclusaoInfo`: quando `pausa_aplicada && qty_excluida_pausa>0` mostra um badge vermelho "X conversoes excluidas por pausa" + "bruto → liquido" + "(−spend equivalente)"; quando houve pausa no mes (`status_windows.pausas` nao vazio) mas `pausa_aplicada===false` pra aquele pub, mostra warning ambar sutil "sem granularidade diaria — exclusao nao aplicada" (pra nao achar que descontou). Tudo read-only, sem recalculo no front. Tipos: `FechamentoPublisher` ganhou os 4 campos; `Fechamento` ganhou `status_windows?`; `PublisherRow`/`toRow`/`addPub` mapeiam os campos novos. **Backend e job do subagente `tracker`.**
- [x] **Fase 4.15 — publisher referencia fornecedor (suppliers)** (30/06): Fase 0 da unificacao de publisher. O nome do publisher deixou de ser texto livre e passou a referenciar um cadastro de fornecedor. O backend (tracker) ja aceita/retorna `supplier_id` por publisher e resolve `nome` a partir dele (`nome` no input virou opcional). No `components/campanha-form.tsx` o input de texto "Nome" de cada publisher virou um combobox com busca (`SupplierCombobox`) que lista `GET /suppliers?is_publisher=true&active=true` (response `{ items: [{ id, name, default_moeda }] }`, carregado 1x no mount, ordenado por nome, tolera falha → []). Ao escolher um fornecedor grava `supplier_id` + `nome` (do supplier) no publisher e, **na primeira escolha** (`supplier_id` ainda null), pre-preenche a `moeda` do PO com `default_moeda` do supplier (editavel depois). Na edicao, o combobox pre-seleciona pelo `supplier_id` que vem no GET detalhe; defensivo: publisher sem `supplier_id` (campanha antiga) mostra o `nome` legado como fallback ("— sem cadastro") e permite escolher. Save manda `supplier_id` por publisher; validacao agora exige fornecedor (ou nome legado) em vez do nome texto-livre. Tipos novos em `types/index.ts`: `Supplier`/`SuppliersResponse`; `CampanhaPublisher` ganhou `supplier_id?`. **Backend (suppliers + `supplier_id` no publisher) e job do subagente `tracker`** — o front so consome.
- [x] **Fase 4.16 — cap de eventos por EVENTO** (30/06): replicou o padrao do cap de publisher pro nivel de evento. Cada evento na secao "Eventos pagos" do `components/campanha-form.tsx` ganhou um cap opcional (tipo nenhum/mensal/diario, unidade eventos/US$, valor, vigencia inicio) reusando o `CapBlock` (que ganhou props `title`/`hideVigenciaFim`/`renegNote` pra servir os dois niveis — evento nao usa vigencia_fim). Na edicao pre-carrega o cap vigente + mostra historico; mudanca material (tipo/unidade/valor) de cap ja vigente abre `EventoCapReasonModal` pedindo o MOTIVO da renegociacao (analogo ao `CapEffectiveDateModal` do publisher, que pede data). Payload envia `cap` por evento em `eventos_pagos[]` no shape `EventoCapInput` (`tipo, unidade, valor, vigencia_inicio, reason`). Tipos novos em `types/index.ts`: `CampanhaEventoCap`; `CampanhaEvento` ganhou `cap?` + `caps_historico?`. Helper local `capToRow` generalizado pra `CapLike` (serve publisher e evento). **Backend (slug `cap-eventos-evento`, EventoCapInput + caps_historico no GET detalhe) e job do subagente `tracker`** — front consome.
- [x] **Fase 4.17 — partilha Wave no fechamento** (30/06): quando o cliente do fechamento e parceiro de partilha (Wave), o `components/campanha-fechamento-modal.tsx` mostra um bloco "Partilha (Wave)" com **Imposto %** (editavel, default = `default_imposto_pct` do client ou 12,27) e **Cambio (US$ → moeda do fechamento)** (`fx_rate`, editavel), exibindo com destaque o **Custo publishers (convertido)** e o **A receber liquido (Caracol)** = `(spend_final − spend_final×imposto/100 − custo_publisher_total)/3`, deixando claro que o valor cheio NAO e o que a Caracol recebe. Previa calculada client-side com a mesma formula (backend recalcula no save). `imposto_pct` e `fx_rate` vao na raiz do payload do POST. Cliente normal (nao-partner): nada muda. Decisao de mostrar via `client.is_revenue_share_partner` (com fallback no `fechamento.is_revenue_share`); imposto% pre-preenchido na troca de cliente. Tipos: `Client` ganhou `is_revenue_share_partner`/`default_imposto_pct`; `Fechamento` ganhou `is_revenue_share`/`imposto_pct`/`fx_rate`/`custo_publisher_total`/`a_receber_liquido`; `FechamentoUpsertPayload` ganhou `imposto_pct`/`fx_rate`. **Backend (migrations 053/054, campos no GET/POST do fechamento + flags no /clients) e job do subagente `tracker`** — front consome.
- [x] **Fase 4.18 — big numbers de lucro + conta do Wave** (30/06): (1) `/desempenho` ganhou 3 KPIs novos (Lucro Bruto, Lucro Liquido, LL Caracol) ao lado do "Faturamento fechado", consumindo as chaves novas do `/fechamento/summary` por moeda (`lucro_bruto_brl/usd`, `lucro_liquido_brl/usd`, `ll_caracol_brl/usd`): valor em BRL + USD no sublabel quando > 0 (helper `moedaPairCard`); grid passou a `lg:grid-cols-4`. (2) Bloco "Partilha (Wave)" do `campanha-fechamento-modal.tsx` reorganizado pra mostrar a conta clara: NF faturada → − custo publishers (convertido) → Lucro bruto → − imposto → Lucro liquido → Margem Caracol (1/3), e em destaque o **A receber de Wave = custo + margem** (reembolso do custo + fatia da Caracol). Deixa claro que a Caracol fica so com 1/3 do lucro liquido. Previa client-side (`waveCalc`) com as formulas do backend (que recalcula no save). Tipos: `FechamentoSummary` +6 campos de lucro; `Fechamento` +`lucro_bruto`/`lucro_liquido`/`margem_caracol` (`a_receber_liquido` agora == `margem_caracol`, deprecated). **Backend (chaves no summary + serialize do fechamento) e job do subagente `tracker`** — front consome.
- [x] **Fase 4.19 — cap por (publisher × evento)** (01/07): cada evento na lista "PO por evento" de um publisher (`components/campanha-form.tsx`) ganhou um **cap opcional proprio** (reusa o `CapBlock`, mesmo shape do cap geral do publisher — tipo nenhum/mensal/diario, unidade eventos/US$, valor, vigencia inicio/fim). Coexiste com o **cap GERAL do publisher** (que continua existindo, agora rotulado "Cap geral do publisher"). Cada combinacao (geral, por evento, ambos, nenhum) e independente. `PublisherPayoutRow` ganhou `cap: CapRow` + `caps_historico`; `publisherToRow` pre-carrega os caps por evento a partir de `p.caps_por_evento` (casando por `evento_nome`); o efeito de reconciliacao dos payouts passou a preservar o objeto inteiro (payout + cap) por nome (evento renomeado/removido vira novo, defensivo). **Payload migrou de `cap` (geral) pra `caps` (LISTA autoritativa)** por publisher: cap geral (`evento_nome: null`) + um item por evento com cap (`evento_nome` preenchido), cada um no shape `CampanhaPublisherCapInput` (`tipo, unidade, valor, vigencia_inicio, vigencia_fim, data_efetiva, evento_nome`); `tipo='nenhum'` so e enviado pra encerrar cap que ja existia. Renegociacao (mudanca material de tipo/unidade/valor de cap ja vigente) reusa o `CapEffectiveDateModal` (data efetiva) tanto pro geral quanto pros por evento — helper `buildCapInput` centraliza validacao + deteccao de renegociacao. Tipos novos em `types/index.ts`: `CampanhaPublisherCapInput`, `CampanhaPublisherCapPorEvento`; `CampanhaPublisher` ganhou `caps_por_evento?`. **Backend (caps por evento no GET detalhe via `caps_por_evento` + campo `caps` no PATCH/POST) ja no ar — job do subagente `tracker`.** Front consome.
- [x] **Fase 4.20 — apuracao do cap por evento no fechamento (display only)** (01/07): o backend passou a apurar o **cap POR EVENTO** no fechamento e retorna `caps_evento` em dois lugares do response: (a) dentro de cada `publishers[]` (cap por evento daquele publisher) e (b) na RAIZ do `Fechamento` (cap por evento da campanha = soma dos publishers). Shape de cada item: `{evento_nome, cap_tipo ("mensal"|"diario"), cap_unidade ("eventos"), realizado_qty, valido_qty, excedente_qty, cap_breakdown: [{inicio, fim, cap, unidade, dias, realizado, valido, excedente}]}`. **E INFORMATIVO — nao afeta o pagamento** (diferente do cap de publisher, que corta o `spend_valido`). No `components/campanha-fechamento-modal.tsx`, o componente `CapsEventoBlock` (cor sky, pra diferenciar do amber do cap de publisher) renderiza por evento "Evento X — cap {tipo}: realizado / valido / excedente" com o excedente em vermelho quando > 0, e o rotulo "apuracao por evento (nao altera pagamento)". Aparece: (1) por publisher, na sub-linha do cap (abaixo do `CapExcedenteBlock` quando ambos existem); (2) na secao raiz "Caps por evento (campanha)" apos a tabela de publishers. Defensivo: `caps_evento` ausente/vazio nao mostra nada (dado antigo). Tipos novos em `types/index.ts`: `CapEvento`, `CapEventoBreakdownPeriodo`; `FechamentoPublisher` e `Fechamento` ganharam `caps_evento?`; `PublisherRow`/`toRow`/`addPub` mapeiam o campo. **Backend (apuracao do cap por evento + `caps_evento` no GET do fechamento) e job do subagente `tracker`** — front consome.
- [ ] **Fase 5 — integracao com NF**: NF passa a usar dropdown de campanhas em vez de texto livre; FK `nf_invoices.campanha_id` + backfill

## Decisoes tomadas

1. **App separado** em vez de modulo dentro do Tracker ou do NF — campanhas e dominio compartilhado, faz sentido como entidade primaria.

2. **Helpers reaproveitados do NF/Tracker** (api.ts, auth-context.tsx, toast-context.tsx, config.ts, app-shell, status-badge, navbar) — copiados manualmente. Quando o quarto app aparecer, extrair pra `@caracol/ui`.

3. **Mesma instancia Supabase do Tracker/NF** — tabela `campanhas` no schema publico, **sem prefixo**. Permite SSO trivial e reuso de auth.

4. **Backend unico no Tracker** — rotas `/api/v1/campanhas/*` em `tracker-caracol/backend/app/routes/campanhas.py`. Decisao alinhada com o padrao da suite.

5. **Lista tolera backend ausente** — `GET /campanhas` que retorna 404 ou "failed to fetch" e tratado como lista vazia, sem erro visivel. Permite trabalhar no front antes do backend existir.

6. **Sem `BootstrapGate` na fase 0** — auth simples via cookie + middleware basta enquanto o backend nao expoe `/hub/me/apps` com slug `campanhas`. Adicionar na fase 2.

7. **Tema/branding identico ao NF** — mesmas variaveis HSL em `app/globals.css`, mesma logo Caracol clicavel pro Hub. So muda title/description e copy.

8. **Parceria Wave + coleta manual** (01/06) — `parceria_wave` controla quais campanhas entram no relatorio do api_af enviado pro parceiro Wavesync (filtro `--only-wave` no `daily_runner`, default Nao = fail-safe, nao vaza). `coleta_manual` tira a campanha do `apps.yaml` (robo nao busca) e libera o form "Inserir metrics manualmente" mesmo em `mmp=appsflyer`. Os flags moram no backend (`campanhas.parceria_wave`/`coleta_manual`), o front so consome. O auto-calculo de `%MTD`/`%budget` no metrics manual e feito no backend (espelha `api_af/src/analysis/pace.py`).

## Como editar

- **Codespaces** ou local: `git clone`, `npm install`, `npm run dev`.
- Cada push em `main` re-deploya na Vercel automaticamente (depois que o repo + projeto Vercel forem criados).

## Para retomar o trabalho

Se voce e uma IA chegando aqui sem contexto:

1. **Leia este doc inteiro** antes de propor mudancas.
2. **Estado: fase 0 (scaffold).** Backend nao existe — telas funcionam em modo placeholder.
3. **Auth e cookie compartilhado**: qualquer mudanca em `lib/auth-context.tsx` precisa ser replicada em `caracol-hub`, `caracol-nf` e `tracker-caracol`. Job do orquestrador, nao do subagente.
4. **Backend nao vive aqui** — vai viver em `tracker-caracol/backend/app/routes/campanhas.py`. Tarefa de backend = subagente `tracker`.
5. Quando o subdominio `campanhas.aeobr.com.br` for criado: Cloudflare em **DNS only (cinza)**, sem proxy. CORS no Tracker tem que incluir esse subdominio (job do subagente `tracker`). Tile no Hub (job do subagente `hub`).
6. Helpers que ja existem — **nao reinvente**:
   - `apiFetch` pra fetch com Bearer (refresh automatico em 401)
   - `useToast` pra notificacoes
   - `useAuth` pra sessao
   - `StatusBadge`, `AppShell`, `Navbar`
