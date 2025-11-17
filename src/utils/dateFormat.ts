/**
 * Utilitário para formatação de datas no padrão brasileiro
 * Formato: dd/MM/yyyy HH:mm (sem AM/PM)
 */

/**
 * Formata data e hora no padrão brasileiro
 * @param date - String ISO ou objeto Date
 * @returns String no formato "dd/MM/yyyy às HH:mm"
 */
export const formatDateTime = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '-';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  return `${day}/${month}/${year} às ${hours}:${minutes}`;
};

/**
 * Formata apenas a data no padrão brasileiro
 * @param date - String ISO ou objeto Date
 * @returns String no formato "dd/MM/yyyy"
 */
export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '-';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  
  return `${day}/${month}/${year}`;
};

/**
 * Formata apenas a hora no padrão brasileiro
 * @param date - String ISO ou objeto Date
 * @returns String no formato "HH:mm"
 */
export const formatTime = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '-';
  
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  return `${hours}:${minutes}`;
};

/**
 * Converte data no formato brasileiro para ISO (para enviar ao backend)
 * @param dateStr - String no formato "dd/MM/yyyy" ou "dd/MM/yyyy HH:mm"
 * @returns String ISO ou null se inválido
 */
export const parseBrazilianDate = (dateStr: string): string | null => {
  if (!dateStr) return null;
  
  // Formato: dd/MM/yyyy HH:mm
  const dateTimeMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (dateTimeMatch) {
    const [, day, month, year, hours, minutes] = dateTimeMatch;
    return `${year}-${month}-${day}T${hours}:${minutes}:00`;
  }
  
  // Formato: dd/MM/yyyy
  const dateMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    return `${year}-${month}-${day}T00:00:00`;
  }
  
  return null;
};

/**
 * Formata input datetime-local para exibição brasileira
 * @param isoString - String no formato "yyyy-MM-ddTHH:mm"
 * @returns String no formato "dd/MM/yyyy HH:mm"
 */
export const formatInputDateTime = (isoString: string): string => {
  if (!isoString) return '';
  
  const [datePart, timePart] = isoString.split('T');
  const [year, month, day] = datePart.split('-');
  
  if (timePart) {
    return `${day}/${month}/${year} ${timePart}`;
  }
  
  return `${day}/${month}/${year}`;
};

/**
 * Converte data brasileira para formato datetime-local input
 * @param brazilianDate - String no formato "dd/MM/yyyy HH:mm"
 * @returns String no formato "yyyy-MM-ddTHH:mm"
 */
export const toBrazilianInputFormat = (brazilianDate: string): string => {
  const parsed = parseBrazilianDate(brazilianDate);
  if (!parsed) return '';
  
  // Remove segundos e timezone
  return parsed.substring(0, 16);
};
