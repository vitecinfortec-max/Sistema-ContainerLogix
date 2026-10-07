import { useEffect, useMemo, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { api } from '../../lib/api';
import { getCompanyLogoUrl } from '../../lib/useCompanySettings';
import {
  PRINT_COLORS, PrintHeader, PrintSection, PrintFieldGrid, PrintText, PrintPhotoGrid, PrintSignatures, PrintClosing,
} from '../PrintDocument';
import {
  CHECKLIST_PHOTO_LABELS, CHECKLIST_PHOTO_TYPES, RESULT_META, VEHICLE_TYPE_LABELS,
  checklistCode, checklistItems, countAnswers, formatKm, resultFromCounts,
} from './checklistShared';

// Impressão do Checklist de Veículo (modelo atual) pelo navegador, no visual
// padrão dos documentos do sistema (components/PrintDocument.jsx): a primeira
// página traz identificação, itens, assinaturas e código de barras; as fotos
// vão em páginas próprias (anexo fotográfico), 12 por página.

const PHOTOS_PER_PAGE = 12;
const PHOTO_ORDER = CHECKLIST_PHOTO_TYPES.map(({ value }) => value);
const RESULT_COLORS = { APROVADO: '#15803D', REPROVADO: '#B91C1C', PENDENTE: PRINT_COLORS.muted };
const ANSWER_MARKS = {
  SIM: { text: 'SIM', color: '#15803D' },
  NAO: { text: 'NÃO', color: '#B91C1C' },
};

const pageStyle = {
  width: '210mm',
  padding: '10mm 12mm',
  fontFamily: 'Helvetica, Arial, sans-serif',
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

function barcodeImage(value) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, { format: 'CODE128', width: 2.2, height: 55, displayValue: false, lineColor: '#000000', margin: 5 });
  return canvas.toDataURL('image/png');
}

const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : '-';
};

// Até 6 fotos (uma de cada posição): 2 colunas com fotos grandes. Acima disso,
// 3 colunas, e a página cheia (12 fotos) ainda cabe numa folha.
const photoLayout = (count) => (count <= 6 ? { columns: 2, height: '68mm' } : { columns: 3, height: '50mm' });

/**
 * `onReady` é chamado quando o documento pode ir pra impressora: fotos e logo
 * carregados (ou 6 s, o que vier primeiro).
 */
export default function ChecklistPrintView({ checklist, company, onReady }) {
  const rootRef = useRef(null);
  const code = checklistCode(checklist.checklist_number);
  const barcode = useMemo(() => barcodeImage(code), [code]);
  const sections = checklist.checklist_sections || [];
  const counts = countAnswers(checklistItems(checklist));
  const result = resultFromCounts(counts);
  const photos = [...(checklist.photos || [])].sort((a, b) => PHOTO_ORDER.indexOf(a.type) - PHOTO_ORDER.indexOf(b.type));
  const photoPages = [];
  for (let i = 0; i < photos.length; i += PHOTOS_PER_PAGE) photoPages.push(photos.slice(i, i + PHOTOS_PER_PAGE));
  const subtitle = `Checklist Nº ${checklist.checklist_number}`;

  useEffect(() => {
    if (!onReady) return undefined;
    let cancelled = false;
    const images = Array.from(rootRef.current?.querySelectorAll('img') || []);
    const loaded = Promise.all(images.map((img) => (img.complete
      ? Promise.resolve()
      : new Promise((resolve) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); }))));
    const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    // O mínimo de 400 ms dá tempo de a janela de detalhes terminar de fechar
    Promise.all([Promise.race([loaded, wait(6000)]), wait(400)]).then(() => { if (!cancelled) onReady(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="print-only" ref={rootRef}>
      <div className="print-registry print-doc print-flow" style={pageStyle}>
        <PrintHeader company={company} logoUrl={getCompanyLogoUrl(company)} title="Checklist de Veículo" subtitle={subtitle} />

        <PrintSection title="Identificação">
          <PrintFieldGrid fields={[
            ['Tipo de Veículo', VEHICLE_TYPE_LABELS[checklist.vehicle_type]],
            ['Placa', checklist.vehicle_plate],
            ['Km Atual', formatKm(checklist.current_km)],
            ['Data/Hora', formatDateTime(checklist.inspection_datetime)],
            ['Motorista', checklist.driver_name],
            ['Vistoriador', checklist.vistoriador_name],
            ['Itens conferidos', `${counts.answered} de ${counts.total}`],
            ['Resultado', <span key="result" style={{ color: RESULT_COLORS[result] }}>{RESULT_META[result].label.toUpperCase()}</span>],
          ]} />
        </PrintSection>

        {sections.length > 0 && (
          <PrintSection title="Itens de Verificação" style={{ breakInside: 'auto', pageBreakInside: 'auto' }}>
            <div style={{ columnCount: 2, columnGap: '16pt' }}>
              {sections.map((section) => (
                <div key={section.label} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', marginBottom: '6pt' }}>
                  <div style={{ fontSize: '8pt', lineHeight: '10pt', fontWeight: 'bold', color: PRINT_COLORS.dark, textTransform: 'uppercase', marginBottom: '1.5pt' }}>
                    {section.label}
                  </div>
                  {(section.items || []).map((item) => {
                    const mark = ANSWER_MARKS[item.answer] || { text: '-', color: PRINT_COLORS.muted };
                    return (
                      <div key={item.text} style={{ borderBottom: `0.5pt solid ${PRINT_COLORS.line}`, padding: '2pt 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6pt', fontSize: '8pt', lineHeight: '10pt', color: PRINT_COLORS.text }}>
                          <span>{item.text}</span>
                          <span style={{ fontWeight: 'bold', color: mark.color, flexShrink: 0 }}>{mark.text}</span>
                        </div>
                        {item.answer === 'NAO' && item.note && (
                          <div style={{ fontSize: '7pt', lineHeight: '9pt', color: '#B91C1C' }}>Apontamento: {item.note}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </PrintSection>
        )}

        {checklist.observations && (
          <PrintSection title="Observações">
            <PrintText>{checklist.observations}</PrintText>
          </PrintSection>
        )}

        <PrintSignatures signers={[
          ['Assinatura do Motorista', checklist.driver_name],
          ['Assinatura do Vistoriador', checklist.vistoriador_name],
        ]} />

        <PrintClosing
          barcodeImage={barcode}
          code={code}
          fields={[
            ['Registrado por', checklist.created_by_name],
            ['Data de criação', formatDateTime(checklist.created_at)],
            ['Data de emissão', formatDateTime(new Date())],
          ]}
          companyName={company.name}
          note={photos.length > 0
            ? `Este documento é válido como registro de checklist do veículo  ·  ${photos.length} foto${photos.length > 1 ? 's' : ''} em anexo`
            : 'Este documento é válido como registro de checklist do veículo'}
        />
      </div>

      {photoPages.map((pagePhotos, index) => {
        const layout = photoLayout(pagePhotos.length);
        return (
          <div key={pagePhotos[0].id} className="print-registry print-doc print-flow print-page-break" style={pageStyle}>
            <PrintHeader
              company={company}
              logoUrl={getCompanyLogoUrl(company)}
              title="Checklist de Veículo"
              subtitle={`${subtitle}  ·  Anexo fotográfico${photoPages.length > 1 ? ` ${index + 1}/${photoPages.length}` : ''}`}
            />
            <PrintSection
              title={`Fotos do Veículo  ·  ${VEHICLE_TYPE_LABELS[checklist.vehicle_type] || ''} ${checklist.vehicle_plate || ''}`}
              style={{ breakInside: 'auto', pageBreakInside: 'auto' }}
            >
              <PrintPhotoGrid
                photos={pagePhotos}
                getLabel={(photo) => CHECKLIST_PHOTO_LABELS[photo.type] || photo.type}
                getUrl={(photo) => api.getFileUrl(photo.url)}
                columns={layout.columns}
                imageHeight={layout.height}
                compactImageHeight={layout.height}
              />
            </PrintSection>
          </div>
        );
      })}
    </div>
  );
}
