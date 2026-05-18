# Caracol Campanhas

App da suite Caracol pra **cadastrar e gerenciar campanhas**. Fonte de verdade pras campanhas usadas no NF, no Tracker e nos demais apps da suite.

Faz parte da suite Caracol — entrada pelo [Hub](https://app.aeobr.com.br).

## Status: fase 0 (scaffold)

Estrutura clonada do `caracol-nf`, telas placeholder de campanhas montadas. Backend ainda nao existe — endpoints sao chamados em modo tolerante (404 silencioso). Ver `CONTEXT.md` pro roadmap completo.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (mesmo tema laranja escuro da suite)
- js-cookie pra sessao
- Auth via API do Tracker (`POST /api/v1/auth/login`) com SSO via cookie `.aeobr.com.br`
- **Sem backend proprio** — rotas `/api/v1/campanhas/*` vivem em `tracker-caracol/backend/app/routes/campanhas.py`

## Telas

- `/login` — login conectado a API do Tracker (SSO compartilhado com Hub/NF/Tracker)
- `/` — landing logada com atalhos pra lista e nova campanha
- `/campanhas` — lista (placeholder; tolera backend 404). Colunas: Nome, Status, Owner, Acoes
- `/campanhas/new` — form de criacao (nome obrigatorio; slug e status opcionais)
- `/campanhas/[id]` — detalhe placeholder (Editar fica pra fase 2)

## URLs e infra

| | |
|---|---|
| Producao | https://campanhas.aeobr.com.br |
| Vercel project | caracol-campanhas |
| DNS | Cloudflare, modo **DNS only (nuvem cinza)**, CNAME `campanhas` → `cname.vercel-dns.com` |
| Backend | `tracker-caracol/backend/app/routes/campanhas.py` (fase 1, ainda nao existe) |

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

Vercel detecta o repo e builda em cada push pra `main`. Dominio `campanhas.aeobr.com.br` aponta pro projeto.

Configurar na Vercel as mesmas env vars do `.env.example`, com `NEXT_PUBLIC_API_URL=https://trk.aeobr.com.br`.

## Backend

Vive no Tracker — qualquer rota nova em `/api/v1/campanhas/*` e trabalho do subagente `tracker`. Repo: https://github.com/epicchiotti2103/tracker-caracol.

## Helpers reaproveitados

Copiados do NF/Tracker — quando o quarto app aparecer, vale extrair pra um pacote `@caracol/ui`:

- `lib/api.ts` (fetch com Bearer e refresh automatico)
- `lib/auth-context.tsx` (**nao editar** sem alinhar com o orquestrador — replicado em N apps)
- `lib/toast-context.tsx`
- `lib/config.ts`
- `components/app-shell.tsx`, `components/navbar.tsx`, `components/status-badge.tsx`
