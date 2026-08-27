import React, { useEffect, useState } from 'react';
import { copyText, formatDate, formatDateTime, pixRecipientFromBrCode, type Gift } from './publicTithe';

interface Props {
  gift: Gift;
  /** Nome do recebedor vindo da página da paróquia; sem ele, lê do próprio BR Code. */
  merchantName?: string | null;
  /** Pix estático: "Já fiz o Pix" (avisa a tesouraria). */
  onDeclare?: () => void;
  declaring?: boolean;
}

/** Instruções de pagamento de uma oferta em aberto: QR/copia e cola, cartão ou boleto. */
const GiftPaymentPanel: React.FC<Props> = ({ gift, merchantName, onDeclare, declaring = false }) => {
  const [copied, setCopied] = useState<'pix' | 'boleto' | null>(null);
  const [showPixAgain, setShowPixAgain] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const brCode = gift.brCode;
  const boletoLine = gift.boletoLine;
  const recipient = merchantName || pixRecipientFromBrCode(brCode).merchantName;
  const expiresAt = gift.qrExpiresAt ? new Date(gift.qrExpiresAt) : null;
  const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;
  const isStaticPix = gift.method === 'PIX_STATIC';
  const declared = gift.status === 'DECLARED';

  const copy = async (what: 'pix' | 'boleto', text: string) => {
    const ok = await copyText(text);
    setCopied(ok ? what : null);
    if (!ok) window.prompt('Copie o código abaixo:', text);
  };

  const pixView = brCode ? (
    <>
      {gift.qrDataUrl && <img className="donate-qr" src={gift.qrDataUrl} alt="QR Code do Pix" />}
      <p className="donate-muted donate-center">
        Abra o app do seu banco, escolha <strong>Pix → Ler QR Code</strong>, ou use o copia e cola:
      </p>
      <div className="donate-copy">
        <textarea
          className="donate-input"
          readOnly
          value={brCode}
          aria-label="Código Pix copia e cola"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="donate-btn" onClick={() => void copy('pix', brCode)}>
          {copied === 'pix' ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
      {recipient && (
        <p className="donate-recipient">
          Confira o recebedor no seu banco: <strong>{recipient}</strong>
        </p>
      )}
      {expiresAt && (
        <p className="donate-recipient">
          {expired ? 'Este Pix expirou — faça uma nova oferta.' : `Válido até ${formatDateTime(gift.qrExpiresAt)}`}
        </p>
      )}
      {gift.paymentUrl && (
        <a className="donate-btn is-secondary" href={gift.paymentUrl} target="_blank" rel="noopener noreferrer">
          Abrir página de pagamento
        </a>
      )}
    </>
  ) : (
    <p className="donate-muted donate-center">O código Pix não está disponível no momento. Atualize a página em instantes.</p>
  );

  const cardView = (
    <>
      {gift.paymentUrl ? (
        <a className="donate-btn" href={gift.paymentUrl} target="_blank" rel="noopener noreferrer">
          Pagar com cartão
        </a>
      ) : (
        <p className="donate-muted donate-center">O link de pagamento ainda não está disponível. Atualize em instantes.</p>
      )}
      <p className="donate-muted donate-center">
        Você será levado ao ambiente seguro do provedor de pagamento. A confirmação é automática.
      </p>
      {expiresAt && !expired && <p className="donate-recipient">Link válido até {formatDateTime(gift.qrExpiresAt)}</p>}
    </>
  );

  const boletoView = (
    <>
      {gift.boletoUrl ? (
        <a className="donate-btn" href={gift.boletoUrl} target="_blank" rel="noopener noreferrer">
          Abrir boleto
        </a>
      ) : (
        <p className="donate-muted donate-center">O boleto ainda não está disponível. Atualize em instantes.</p>
      )}
      {boletoLine && (
        <>
          <p className="donate-muted donate-center" style={{ marginTop: 12 }}>
            Linha digitável:
          </p>
          <div className="donate-copy">
            <textarea
              className="donate-input"
              readOnly
              value={boletoLine}
              aria-label="Linha digitável do boleto"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="donate-btn" onClick={() => void copy('boleto', boletoLine)}>
              {copied === 'boleto' ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </>
      )}
      {expiresAt && (
        <p className="donate-recipient">
          {expired ? 'O boleto venceu — faça uma nova oferta.' : `Vencimento: ${formatDate(gift.qrExpiresAt)}`}
        </p>
      )}
      <p className="donate-muted donate-center">
        A compensação do boleto pode levar até 3 dias úteis. A confirmação é automática.
      </p>
    </>
  );

  return (
    <div className="donate-payment">
      {declared && isStaticPix && (
        <div className="donate-alert is-info" role="status">
          Você avisou que já fez o Pix. A tesouraria vai conferir e o comprovante chega no seu e-mail.
        </div>
      )}

      {gift.paymentMethod === 'PIX' &&
        (declared && isStaticPix && !showPixAgain ? (
          <button type="button" className="donate-btn is-ghost" onClick={() => setShowPixAgain(true)}>
            Ver o código Pix novamente
          </button>
        ) : (
          pixView
        ))}
      {gift.paymentMethod === 'CARD' && cardView}
      {gift.paymentMethod === 'BOLETO' && boletoView}

      {isStaticPix && gift.status === 'CREATED' && onDeclare && (
        <div className="donate-actions">
          <button type="button" className="donate-btn is-secondary" onClick={onDeclare} disabled={declaring} aria-busy={declaring}>
            {declaring ? 'Enviando aviso…' : 'Já fiz o Pix'}
          </button>
          <p className="donate-muted donate-center">
            Depois de pagar, avise a paróquia: a tesouraria confere e envia o comprovante por e-mail.
          </p>
        </div>
      )}
      {!isStaticPix && gift.paymentMethod === 'PIX' && (
        <p className="donate-muted donate-center" style={{ marginTop: 12 }}>
          A confirmação é automática assim que o banco avisar — costuma levar poucos segundos.
        </p>
      )}
    </div>
  );
};

export default GiftPaymentPanel;
