import { toast } from 'sonner';
import { api } from './api';
import { apiErrorMessage } from './errors';

// Contrato de Frete (RPA terceiro): usado pela lista e pelo formulário

export const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function downloadFreightContractPdf(id, num) {
  try {
    const r = await api.getRPATerceiroPDF(id);
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ContratoFrete_${num}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success('PDF gerado!');
  } catch (e) {
    toast.error(apiErrorMessage(e, 'Erro ao gerar PDF'));
  }
}
