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
    bootstrap-gate.tsx           Gate de acesso via /hub/me/apps
    campanha-form.tsx            Form unico usado em new e edicao inline
    navbar.tsx                   Navbar com logo do Hub e nav de campanhas
    status-badge.tsx             Badge de status da campanha
  lib/
    api.ts                       fetch helper com Bearer + refresh automatico
    auth-context.tsx             Sessao + SSO (REPLICADO nos N apps)
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

## Auth e SSO

Mesmo cookie no dominio raiz `.aeobr.com.br` (igual Hub, NF, Tracker). Em producao, login feito em qualquer app da suite vale aqui. Em dev (`localhost`), sem cross-subdomain.

### Regra critica

`lib/auth-context.tsx` e **identico** ao do Hub, NF e Tracker — qualquer mudanca tem que ser replicada nos N apps simultaneamente ou SSO quebra. Esse arquivo so muda via tarefa do orquestrador, nunca por iniciativa do subagente `campanhas`.

### Controle de admin

- `useAuth().isAdmin` vem direto de `user.hub_role === "admin"`. Sem lista hardcoded de emails.
- Em client components, usar `const { isAdmin } = useAuth()`.
- Em middleware, ler cookie `user_data` e checar `hub_role === "admin"`.

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
- [ ] **Fase 5 — integracao com NF**: NF passa a usar dropdown de campanhas em vez de texto livre; FK `nf_invoices.campanha_id` + backfill

## Decisoes tomadas

1. **App separado** em vez de modulo dentro do Tracker ou do NF — campanhas e dominio compartilhado, faz sentido como entidade primaria.

2. **Helpers reaproveitados do NF/Tracker** (api.ts, auth-context.tsx, toast-context.tsx, config.ts, app-shell, status-badge, navbar) — copiados manualmente. Quando o quarto app aparecer, extrair pra `@caracol/ui`.

3. **Mesma instancia Supabase do Tracker/NF** — tabela `campanhas` no schema publico, **sem prefixo**. Permite SSO trivial e reuso de auth.

4. **Backend unico no Tracker** — rotas `/api/v1/campanhas/*` em `tracker-caracol/backend/app/routes/campanhas.py`. Decisao alinhada com o padrao da suite.

5. **Lista tolera backend ausente** — `GET /campanhas` que retorna 404 ou "failed to fetch" e tratado como lista vazia, sem erro visivel. Permite trabalhar no front antes do backend existir.

6. **Sem `BootstrapGate` na fase 0** — auth simples via cookie + middleware basta enquanto o backend nao expoe `/hub/me/apps` com slug `campanhas`. Adicionar na fase 2.

7. **Tema/branding identico ao NF** — mesmas variaveis HSL em `app/globals.css`, mesma logo Caracol clicavel pro Hub. So muda title/description e copy.

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
