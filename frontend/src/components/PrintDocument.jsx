// Peças dos documentos impressos pelo navegador (window.print) no mesmo visual
// dos PDFs gerados no servidor - espelham os helpers de backend/reports.py:
// _build_pdf_header (cabeçalho), _voucher_boxed_section/_voucher_field (quadros
// de campos), _pdf_barcode_block (código de barras) e o rodapé do comprovante.
// Tamanhos em pt, como lá. As cores são as mesmas constantes de lá
// (PRIMARY_COLOR, BRAND_*) - se mudar uma, mudar a outra.
//
// Não usar <header>/<footer>/<nav>/<button> aqui: o @media print do index.css
// esconde essas tags na impressão.

export const PRINT_COLORS = {
  primary: '#008B7B',
  dark: '#0F172A',
  text: '#334155',
  muted: '#64748B',
  line: '#E2E8F0',
  box: '#F8FAFC',
};

const C = PRINT_COLORS;

/** Logo + empresa à esquerda, título na cor da marca à direita e a faixa verde embaixo. */
export function PrintHeader({ company, logoUrl, title, subtitle }) {
  const address = (company.address || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('  ·  ');
  const contact = [company.email, company.phone].filter(Boolean).join('  ·  ');
  return (
    <div style={{ marginBottom: '10pt' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12pt' }}>
        {logoUrl && (
          <img
            src={logoUrl}
            alt={company.name}
            style={{ maxWidth: '120pt', maxHeight: '58pt', width: 'auto', height: 'auto', flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12pt', lineHeight: '14.5pt', fontWeight: 'bold', color: C.dark }}>{company.name}</div>
          <div style={{ fontSize: '7.5pt', lineHeight: '9.5pt', color: C.muted }}>CNPJ {company.cnpj}</div>
          {address && <div style={{ fontSize: '7.5pt', lineHeight: '9.5pt', color: C.muted }}>{address}</div>}
          {contact && <div style={{ fontSize: '7.5pt', lineHeight: '9.5pt', color: C.muted }}>{contact}</div>}
        </div>
        <div style={{ width: '40%', textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '13pt', lineHeight: '16pt', fontWeight: 'bold', color: C.primary }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: '8.5pt', lineHeight: '11pt', fontWeight: 'bold', color: C.text }}>{subtitle}</div>
          )}
        </div>
      </div>
      <div style={{ height: '2pt', backgroundColor: C.primary, marginTop: '8pt' }} />
    </div>
  );
}

/** Quadro de fundo suave com barra lateral verde e título na cor da marca. */
export function PrintSection({ title, children, style }) {
  return (
    <div style={{
      backgroundColor: C.box,
      border: `0.6pt solid ${C.line}`,
      borderLeft: `2.5pt solid ${C.primary}`,
      padding: '6pt 10pt 8pt',
      marginBottom: '6pt',
      breakInside: 'avoid',
      pageBreakInside: 'avoid',
      ...style,
    }}>
      {title && <div style={{ fontSize: '9pt', fontWeight: 'bold', color: C.primary, marginBottom: '5pt' }}>{title}</div>}
      {children}
    </div>
  );
}

/** Um campo: rótulo pequeno em caixa alta + valor em negrito. */
export function PrintField({ label, value }) {
  const v = value === null || value === undefined || value === '' ? '-' : value;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '6.5pt', lineHeight: '8pt', color: C.muted, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '9.5pt', lineHeight: '12pt', fontWeight: 'bold', color: C.dark, overflowWrap: 'anywhere' }}>{v}</div>
    </div>
  );
}

/** Grade de campos, `columns` por linha (4 = igual ao comprovante de Registro de Gate). */
export function PrintFieldGrid({ fields, columns = 4 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, columnGap: '10pt', rowGap: '7pt' }}>
      {fields.map(([label, value]) => <PrintField key={label} label={label} value={value} />)}
    </div>
  );
}

/** Texto corrido dentro de um PrintSection (observações, lista de itens). */
export function PrintText({ children, strong = false }) {
  return (
    <div style={{
      fontSize: strong ? '9.5pt' : '8.5pt',
      lineHeight: strong ? '12pt' : '11pt',
      fontWeight: strong ? 'bold' : 'normal',
      color: strong ? C.dark : C.text,
      whiteSpace: 'pre-wrap',
    }}>
      {children}
    </div>
  );
}

/** Grade de fotos: rótulo em caixa alta em cima e a foto inteira (sem cortar) numa caixa branca.
 *  A partir de 3 linhas de fotos a altura cai pra `compactImageHeight`, pra que o
 *  documento continue cabendo numa página A4 mesmo com observações e avarias. */
export function PrintPhotoGrid({ photos, getLabel, getUrl, columns = 3, imageHeight = '48mm', compactImageHeight = '37mm' }) {
  const height = Math.ceil(photos.length / columns) >= 3 ? compactImageHeight : imageHeight;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '6pt' }}>
      {photos.map((photo) => (
        <div key={photo.id} style={{ minWidth: 0, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <div style={{
            fontSize: '6.5pt', lineHeight: '8pt', color: C.muted, textTransform: 'uppercase',
            fontWeight: 'bold', marginBottom: '2pt', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {getLabel(photo)}
          </div>
          <div style={{
            height,
            maxHeight: height,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FFFFFF',
            border: `0.6pt solid ${C.line}`,
            borderRadius: '2pt',
            padding: '3pt',
            boxSizing: 'border-box',
          }}>
            <img
              src={getUrl(photo)}
              alt={getLabel(photo)}
              style={{ display: 'block', width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Código de barras + campos de controle ao lado, e a linha de validade do documento embaixo. */
export function PrintClosing({ barcodeImage, code, fields, companyName, note }) {
  return (
    <div style={{ marginTop: '10pt', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16pt' }}>
        {barcodeImage && (
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <img src={barcodeImage} alt="Código de Barras" style={{ height: '38px', width: 'auto', display: 'block' }} />
            <div style={{ fontSize: '8pt', fontWeight: 'bold', color: C.dark, marginTop: '1pt', letterSpacing: '0.5pt' }}>{code}</div>
          </div>
        )}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${fields.length}, 1fr)`, columnGap: '10pt' }}>
          {fields.map(([label, value]) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: '7pt', lineHeight: '9pt', color: C.muted, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontSize: '9pt', lineHeight: '11pt', fontWeight: 'bold', color: C.dark }}>{value || '-'}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{
        borderTop: `0.75pt solid ${C.line}`, marginTop: '8pt', paddingTop: '5pt',
        textAlign: 'center', fontSize: '7pt', color: C.muted,
      }}>
        {companyName}  ·  {note}
      </div>
    </div>
  );
}
