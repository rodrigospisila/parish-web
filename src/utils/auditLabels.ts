/**
 * Rótulos e formatação compartilhados pelas telas de Segurança e Auditoria
 * (Governança de acesso — Dízimo D4.7).
 */

export const ROLE_SHORT_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: 'Admin. do Sistema',
  DIOCESAN_ADMIN: 'Admin. Diocesana',
  PARISH_ADMIN: 'Admin. Paroquial',
  COMMUNITY_COORDINATOR: 'Coord. de Comunidade',
  PASTORAL_COORDINATOR: 'Coord. de Pastoral',
  VOLUNTEER: 'Voluntário(a)',
  FAITHFUL: 'Fiel',
};

export const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Criação',
  UPDATE: 'Atualização',
  DELETE: 'Exclusão',
  READ: 'Consulta',
  EXPORT: 'Exportação',
  LOGIN: 'Login',
  LOGIN_FAILED: 'Falha de login',
  LOGOUT: 'Saída',
  REFRESH: 'Sessão renovada',
  PASSWORD_CHANGED: 'Senha alterada',
  PASSWORD_RESET: 'Senha redefinida',
  PASSWORD_RESET_REQUESTED: 'Redefinição de senha solicitada',
  TWO_FACTOR_SETUP: '2FA: configuração iniciada',
  TWO_FACTOR_ENABLED: '2FA ativado',
  TWO_FACTOR_DISABLED: '2FA desativado',
  TWO_FACTOR_RESET: '2FA redefinido',
  TWO_FACTOR_LOGIN: 'Login com 2FA',
  TWO_FACTOR_LOGIN_FAILED: 'Código 2FA inválido',
  TWO_FACTOR_BACKUP_USED: 'Código de recuperação usado',
  NEW_DEVICE: 'Novo dispositivo',
  DEVICE_FORGOTTEN: 'Dispositivo esquecido',
  SESSIONS_REVOKED: 'Sessões encerradas',
};

export const ENTITY_LABELS: Record<string, string> = {
  User: 'Usuário',
  Auth: 'Autenticação',
  Session: 'Sessão',
  Device: 'Dispositivo',
  Member: 'Membro',
  Community: 'Comunidade',
  Parish: 'Paróquia',
  Diocese: 'Diocese',
  Pastoral: 'Pastoral',
  Event: 'Evento',
  Schedule: 'Escala',
  FinanceEntry: 'Lançamento financeiro',
  FinancialEntry: 'Lançamento financeiro',
  Tithe: 'Dízimo',
  Campaign: 'Campanha',
  Statement: 'Extrato',
  Document: 'Documento',
};

function lookupCaseInsensitive(map: Record<string, string>, key: string): string | undefined {
  if (map[key]) return map[key];
  const lower = key.toLowerCase();
  const found = Object.keys(map).find((candidate) => candidate.toLowerCase() === lower);
  return found ? map[found] : undefined;
}

export function actionLabel(action: string | null | undefined): string {
  if (!action) return '—';
  return lookupCaseInsensitive(ACTION_LABELS, action) ?? action;
}

export function entityLabel(entity: string | null | undefined): string {
  if (!entity) return '—';
  return lookupCaseInsensitive(ENTITY_LABELS, entity) ?? entity;
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_SHORT_LABELS[role] ?? role;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** JSON em uma linha, truncado — para células de resumo. */
export function compactJson(value: unknown, max = 140): string {
  if (value === null || value === undefined) return '';
  let text: string;
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  } catch {
    text = String(value);
  }
  if (!text || text === '{}' || text === '[]') return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** JSON indentado — para o detalhe expandido. */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '');
  } catch {
    return String(value);
  }
}
