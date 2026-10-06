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
  CONSENT_CHANGE: 'Consentimento',
  ANONYMIZE: 'Anonimização',
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
  CatechesisEnrollment: 'Matrícula na catequese',
  CatechesisClass: 'Turma de catequese',
  Consent: 'Consentimento',
};

/** Nomes legíveis das chaves mais comuns nos metadados (o resto aparece como veio). */
const META_KEY_LABELS: Record<string, string> = {
  channel: 'canal',
  guardianConsent: 'termo do responsável',
  imageConsent: 'uso de imagem',
  status: 'situação',
  reason: 'motivo',
  role: 'papel',
  email: 'e-mail',
  amount: 'valor',
  communityId: 'comunidade',
  parishId: 'paróquia',
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

function readableValue(value: unknown, depth: number): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 39)}…` : value;
  // Par [antes, depois] vira "antes → depois"
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => v === null || typeof v !== 'object')) {
      return `${readableValue(value[0], depth + 1)} → ${readableValue(value[1], depth + 1)}`;
    }
    return `${value.length} ${value.length === 1 ? 'item' : 'itens'}`;
  }
  if (typeof value === 'object') {
    if (depth >= 1) return '{…}';
    return readableSummary(value, Infinity, depth + 1);
  }
  return String(value);
}

/**
 * Resumo legível dos metadados para a célula da tabela (B53): "canal: APP ·
 * termo do responsável: sim" em vez do JSON cru; o JSON completo continua no
 * detalhe expandido.
 */
export function readableSummary(value: unknown, max = 160, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object' || Array.isArray(value)) {
    const text = readableValue(value, depth);
    return text === '—' ? '' : text;
  }
  const parts = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => `${META_KEY_LABELS[key] ?? key}: ${readableValue(v, depth)}`);
  const text = parts.join(' · ');
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
