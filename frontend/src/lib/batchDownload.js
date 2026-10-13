// Download em lote dos documentos marcados numa lista (Vistoria de Container,
// Registro Fotográfico, EIR): um arquivo por registro, cada um com o nome do
// próprio documento.
import { toast } from 'sonner';

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pasta onde gravar os arquivos. undefined = o navegador não tem seletor de
// pasta (Firefox, Safari, celular) ou não deixou usar; null = o usuário
// fechou o seletor sem escolher.
const pickFolder = async () => {
  if (typeof window.showDirectoryPicker !== 'function') return undefined;
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (error) {
    return error?.name === 'AbortError' ? null : undefined;
  }
};

/**
 * Baixa os documentos de `items` ([{ filename, load }], `load` devolve o Blob)
 * em arquivos separados. Com mais de um, pede a pasta de destino e grava cada
 * arquivo nela; onde o navegador não tem seletor de pasta, os arquivos vão um
 * a um pra pasta de downloads. Devolve { saved, failed }, ou null se o
 * usuário desistiu de escolher a pasta.
 */
export async function downloadDocumentsInBatch(items) {
  if (items.length === 0) return { saved: 0, failed: [] };

  // Antes de qualquer await: o seletor de pasta só abre dentro do clique
  const folder = items.length > 1 ? await pickFolder() : undefined;
  if (folder === null) return null;

  const toastId = toast.loading(items.length > 1 ? `Gerando 1 de ${items.length}...` : 'Gerando PDF...');
  let saved = 0;
  const failed = [];
  for (let i = 0; i < items.length; i += 1) {
    const { filename, load } = items[i];
    if (items.length > 1) toast.loading(`Gerando ${i + 1} de ${items.length}: ${filename}`, { id: toastId });
    try {
      const blob = await load();
      if (folder) {
        const handle = await folder.getFileHandle(filename, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        saveWithLink(blob, filename);
        // Sem a pausa o navegador descarta parte dos downloads disparados em sequência
        if (i < items.length - 1) await wait(500);
      }
      saved += 1;
    } catch (error) {
      failed.push(filename);
    }
  }

  if (failed.length === 0) {
    const where = folder ? ` na pasta "${folder.name}"` : '';
    toast.success(saved === 1 ? `${items[0].filename} salvo${where}` : `${saved} arquivos salvos${where}`, { id: toastId });
  } else if (saved === 0) {
    toast.error(items.length === 1 ? 'Erro ao gerar o PDF' : 'Nenhum arquivo pôde ser gerado', { id: toastId });
  } else {
    toast.warning(`${saved} arquivos salvos, ${failed.length} com erro: ${failed.join(', ')}`, { id: toastId, duration: 12000 });
  }
  return { saved, failed };
}
