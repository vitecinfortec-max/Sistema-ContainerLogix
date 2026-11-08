import { toast } from 'sonner';
import { api } from './api';
import { apiErrorMessage } from './errors';

// Ordem de Carregamento: opções usadas pela lista e pelo formulário

export const ORDER_TYPE_OPTIONS = [
  ['COLETA', 'Coleta de Container'],
  ['ENTREGA', 'Entrega de Container'],
];

export const STATUS_OPTIONS = [
  ['PENDENTE', 'Pendente'],
  ['APROVADA', 'Aprovada'],
  ['CANCELADA', 'Cancelada'],
];

export async function downloadLoadingOrderPdf(id, num) {
  try {
    const r = await api.getLoadingOrderPDF(id);
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `OrdemCarregamento_${num}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success('PDF gerado!');
  } catch (e) { toast.error(apiErrorMessage(e, 'Erro ao gerar PDF')); }
}
