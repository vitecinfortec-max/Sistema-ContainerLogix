// Download em lote dos documentos marcados numa lista (Vistoria de Container,
// Registro Fotográfico, EIR): um PDF por registro, cada um com o nome do
// próprio documento, todos dentro de uma pasta compactada (.zip).
import { toast } from 'sonner';
import { zipSync } from 'fflate';

/** "Vistoria-TCLU7834740-4.pdf" - tipo do documento, container e número.
 *  Mesma regra de photo_document_filename em backend/reports.py. */
export const documentFilename = (prefix, containerNumber, number) => {
  const container = String(containerNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'SEM-CONTAINER';
  return `${prefix}-${container}-${number}.pdf`;
};

const saveWithLink = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // O navegador ainda está lendo o blob quando o clique volta
  setTimeout(() => window.URL.revokeObjectURL(url), 10000);
};

// Dois registros com o mesmo nome não podem se sobrepor dentro do zip
const uniqueName = (files, filename) => {
  if (!(filename in files)) return filename;
  const base = filename.replace(/\.pdf$/i, '');
  let n = 2;
  while (`${base} (${n}).pdf` in files) n += 1;
  return `${base} (${n}).pdf`;
};

/**
 * Baixa os documentos de `items` ([{ filename, load }], `load` devolve o Blob).
 * Com mais de um, os PDFs vão juntos num único arquivo .zip
 * ("Vistoria-3-documentos.zip"), cada um com o próprio nome; com um só, sai o
 * PDF direto. Devolve { saved, failed }.
 */
export async function downloadDocumentsInBatch(items) {
  if (items.length === 0) return { saved: 0, failed: [] };

  if (items.length === 1) {
    const toastId = toast.loading('Gerando PDF...');
    try {
      saveWithLink(await items[0].load(), items[0].filename);
      toast.success(`${items[0].filename} salvo`, { id: toastId });
      return { saved: 1, failed: [] };
    } catch (error) {
      toast.error('Erro ao gerar o PDF', { id: toastId });
      return { saved: 0, failed: [items[0].filename] };
    }
  }

  const toastId = toast.loading(`Gerando 1 de ${items.length}...`);
  const files = {};
  const failed = [];
  for (let i = 0; i < items.length; i += 1) {
    const { filename, load } = items[i];
    toast.loading(`Gerando ${i + 1} de ${items.length}: ${filename}`, { id: toastId });
    try {
      const blob = await load();
      files[uniqueName(files, filename)] = new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      failed.push(filename);
    }
  }

  const saved = Object.keys(files).length;
  if (saved === 0) {
    toast.error('Nenhum arquivo pôde ser gerado', { id: toastId });
    return { saved, failed };
  }

  // "Vistoria-TCLU7834740-4.pdf" -> "Vistoria-3-documentos.zip"
  const zipName = `${items[0].filename.split('-')[0]}-${saved}-documentos.zip`;
  try {
    // level 0: o PDF já é compactado, recomprimir só gasta tempo
    saveWithLink(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), zipName);
  } catch (error) {
    toast.error('Erro ao montar o arquivo .zip', { id: toastId });
    return { saved: 0, failed: items.map((item) => item.filename) };
  }

  if (failed.length === 0) {
    toast.success(`${saved} arquivos salvos em ${zipName}`, { id: toastId });
  } else {
    toast.warning(`${saved} arquivos salvos em ${zipName}, ${failed.length} com erro: ${failed.join(', ')}`, { id: toastId, duration: 12000 });
  }
  return { saved, failed };
}
