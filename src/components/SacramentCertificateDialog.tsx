import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../services/api';
import { notify } from '../services/notification.service';

/** Com responseType 'blob' o erro do backend também vem como Blob — recupera a mensagem real. */
export const blobErrorMessage = async (error: any, fallback: string): Promise<string> => {
  try {
    if (error?.response?.data instanceof Blob) {
      const parsed = JSON.parse(await error.response.data.text());
      if (parsed?.message) {
        return Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
      }
    }
  } catch {
    // corpo não-JSON — segue para o genérico
  }
  return getErrorMessage(error, fallback);
};

type DocumentKind = 'CERTIDAO' | 'DECLARACAO';

interface Props {
  /** Rota do PDF na API (ex.: /sacraments/:id/certificate.pdf) */
  path: string;
  personName: string;
  sacramentLabel: string;
  /** O assento tem livro + folha + termo? Sem eles o backend emite a declaração. */
  hasNumbering: boolean;
  onClose: () => void;
}

const FINALIDADE_MAX = 120;

const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/**
 * Emissão da certidão sacramental (contrato 1 da Onda 0).
 *
 * - "Finalidade" opcional (até 120 caracteres) vai em `?finalidade=`;
 * - com livro + folha + termo sai a "Certidão de <Sacramento>"; sem eles, a
 *   "Declaração para conferência", que NÃO substitui a certidão — o painel
 *   avisa antes e depois de baixar;
 * - 403 (comunidade sem permissão para leigos) e 409 (sacramento só
 *   informado) chegam com a mensagem do servidor, mostrada aqui.
 */
const SacramentCertificateDialog: React.FC<Props> = ({ path, personName, sacramentLabel, hasNumbering, onClose }) => {
  const [finalidade, setFinalidade] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issuedKind, setIssuedKind] = useState<DocumentKind | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.get(path, {
        params: { finalidade: finalidade.trim() || undefined },
        responseType: 'blob',
      });
      // X-Document-Kind só é legível se o backend o expuser no CORS; senão
      // vale a numeração do assento (mesma regra do servidor)
      const header = String(res.headers?.['x-document-kind'] ?? '').toUpperCase();
      const kind: DocumentKind =
        header === 'CERTIDAO' || header === 'DECLARACAO' ? (header as DocumentKind) : hasNumbering ? 'CERTIDAO' : 'DECLARACAO';
      const disposition = String(res.headers?.['content-disposition'] ?? '');
      const serverName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = serverName || `${kind === 'CERTIDAO' ? 'certidao' : 'declaracao'}_${slug(personName)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (kind === 'CERTIDAO') {
        notify.success('Certidão emitida.');
        onClose();
      } else {
        setIssuedKind(kind);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const message = await blobErrorMessage(err, 'Erro ao emitir a certidão');
      if (status === 409) {
        setError(message || 'Sacramento informado não gera certidão; registre o assento.');
      } else if (status === 403) {
        setError(message || 'Você não tem permissão para emitir esta certidão.');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()} style={{ zIndex: 1100 }}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-label={`Certidão de ${sacramentLabel} — ${personName}`}
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>
          Certidão de {sacramentLabel} — {personName}
        </h2>

        {issuedKind === 'DECLARACAO' ? (
          <>
            <div
              role="status"
              style={{ background: '#fff8e6', border: '1px solid #f2d59b', borderRadius: 8, padding: '10px 12px', color: '#6b4e00' }}
            >
              O documento saiu como <strong>Declaração para conferência</strong>, que não substitui a certidão:
              o assento não tem <strong>livro, folha e termo</strong> preenchidos. Para emitir a certidão, retifique o
              assento informando a numeração do livro de registro.
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={issue}>
            {!hasNumbering && (
              <div
                style={{
                  background: '#fff8e6',
                  border: '1px solid #f2d59b',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: '#6b4e00',
                  fontSize: '0.9rem',
                  marginBottom: '0.75rem',
                }}
              >
                Este assento está sem <strong>livro, folha e termo</strong>: o documento sairá como
                {' '}<strong>Declaração para conferência</strong> (não substitui a certidão).
              </div>
            )}
            <div className="form-group">
              <label htmlFor="cert-finalidade">Finalidade (opcional)</label>
              <input
                id="cert-finalidade"
                type="text"
                maxLength={FINALIDADE_MAX}
                placeholder="Ex.: casamento, crisma, matrícula na catequese"
                value={finalidade}
                onChange={(e) => setFinalidade(e.target.value)}
              />
              <small style={{ color: '#888' }}>Sai impressa no documento. Até {FINALIDADE_MAX} caracteres.</small>
            </div>
            {error && (
              <div className="error-message" role="alert" style={{ color: '#b42318', marginBottom: '0.75rem' }}>
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="btn-submit" disabled={busy}>
                {busy ? 'Emitindo…' : hasNumbering ? 'Emitir certidão' : 'Emitir declaração'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default SacramentCertificateDialog;
