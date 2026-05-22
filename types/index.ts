// Tipos compartilhados do Caracol Campanhas.
// Backend (rotas /api/v1/campanhas/*) vive no Tracker — ver tracker-caracol/backend/app/routes/campanhas.py.

export type CampanhaStatus = "ativa" | "pausada" | "encerrada";

export type Moeda = "BRL" | "USD";

/**
 * 1 evento da campanha = 1 nome + 1 payout numerico.
 * A moeda do payout e a moeda da campanha (campo `moeda` em `Campanha`).
 */
export interface CampanhaEvento {
  nome: string;
  payout: number | null;
}

export interface Campanha {
  id: string;
  codigo?: string | null;
  name: string;
  slug?: string | null;
  status: CampanhaStatus;
  owner_id: string;
  owner_name?: string | null;
  created_at: string;
  updated_at?: string | null;

  // Periodo
  inicio?: string | null;
  fim?: string | null;

  // App e parceiro
  app?: string | null;
  af_prt?: string | null;
  plataforma?: string | null;

  // Financeiro
  budget?: number | null;
  moeda?: Moeda | string | null;
  fluxo?: string | null;

  // Eventos (1 evento = 1 payout). Moeda vem da campanha.
  eventos?: CampanhaEvento[];

  // Criativo e observacoes
  criativo?: string | null;
  obs?: string | null;
}

// Papel de um user dentro de uma campanha (N:N via tabela campanhas_users).
export type CampanhaUserRole = "gestor";

export interface CampanhaUser {
  campanha_id: string;
  user_id: string;
  user_name?: string | null;
  user_email?: string | null;
  role: CampanhaUserRole;
}
