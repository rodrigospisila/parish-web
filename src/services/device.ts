/**
 * Identificação do dispositivo (Governança de acesso — Dízimo D4.7).
 *
 * Um id aleatório persistido no navegador e um nome legível (navegador + SO)
 * são enviados em todas as requisições como `X-Device-Id` / `X-Device-Name`,
 * permitindo ao backend listar dispositivos, encerrar sessões e avisar sobre
 * o primeiro acesso em um aparelho novo.
 */
const DEVICE_ID_KEY = 'parish-device-id';

let cachedId: string | null = null;
let cachedName: string | null = null;

function randomId(): string {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Id estável do navegador (gerado uma vez e guardado em localStorage). */
export function getDeviceId(): string {
  if (cachedId) return cachedId;
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cachedId = stored;
      return stored;
    }
    const id = randomId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    cachedId = id;
    return id;
  } catch {
    // localStorage indisponível (modo privado restrito etc.): id só da sessão
    cachedId = cachedId ?? randomId();
    return cachedId;
  }
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Navegador';
}

function detectOs(ua: string): string {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'SO desconhecido';
}

/**
 * Nome legível do dispositivo, ex.: "Chrome em Windows (web)".
 * Somente ASCII — valores de header não aceitam caracteres fora do ISO-8859-1.
 */
export function getDeviceName(): string {
  if (cachedName) return cachedName;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  cachedName = `${detectBrowser(ua)} em ${detectOs(ua)} (web)`;
  return cachedName;
}
