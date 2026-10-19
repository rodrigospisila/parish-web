/**
 * Conta criada por convite só com celular recebe um e-mail técnico
 * (`tel-<digitos>@sem-email.parish.invalid`) porque o e-mail é obrigatório no
 * cadastro. Ele nunca é mostrado à pessoa.
 */
export const TECHNICAL_EMAIL_DOMAIN = '@sem-email.parish.invalid';

export function displayEmail(email?: string | null): string {
  if (!email || email.toLowerCase().endsWith(TECHNICAL_EMAIL_DOMAIN)) return '';
  return email;
}
