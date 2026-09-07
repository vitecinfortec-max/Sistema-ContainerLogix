import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Edit, Tags, FileDown } from 'lucide-react';

export default function ServicePriceTablePage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [clients, setClients] = useState([]);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [clientNameInput, setClientNameInput] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);

  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const [serviceNameInput, setServiceNameInput] = useState('');
  const [selectedServiceType, setSelectedServiceType] = useState(null);
  const [valueInput, setValueInput] = useState('');
  const [editId, setEditId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    if (selectedClient) loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient]);

  const loadBaseData = async () => {
    try {
      const [clientsRes, serviceTypesRes] = await Promise.all([api.getClients(), api.getServiceTypes()]);
      setClients(Array.isArray(clientsRes.data) ? clientsRes.data : []);
      setServiceTypes(Array.isArray(serviceTypesRes.data) ? serviceTypesRes.data : []);
    } catch (error) {
      toast.error('Erro ao carregar clientes/serviços');
    }
  };

  const loadEntries = async () => {
    setLoadingEntries(true);
    try {
      const response = await api.getServicePriceEntries({ client_id: selectedClient.id });
      setEntries(response.data);
    } catch (error) {
      toast.error('Erro ao carregar tabela de serviços do cliente');
    } finally {
      setLoadingEntries(false);
    }
  };

  const handleSelectClient = (client) => {
    setSelectedClient(client);
    resetEntryForm();
  };

  const resetEntryForm = () => {
    setServiceNameInput('');
    setSelectedServiceType(null);
    setValueInput('');
    setEditId(null);
  };

  const startEdit = (entry) => {
    setEditId(entry.id);
    setServiceNameInput(entry.service_type_name);
    setSelectedServiceType({ id: entry.service_type_id, name: entry.service_type_name });
    setValueInput(String(entry.value));
  };

  const handleSubmitEntry = async (e) => {
    e.preventDefault();
    if (!selectedServiceType) {
      toast.error('Selecione um serviço');
      return;
    }
    if (!valueInput || Number(valueInput) < 0) {
      toast.error('Informe um valor válido');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { client_id: selectedClient.id, service_type_id: selectedServiceType.id, value: Number(valueInput) };
      if (editId) {
        await api.updateServicePriceEntry(editId, payload);
        toast.success('Preço atualizado com sucesso');
      } else {
        await api.createServicePriceEntry(payload);
        toast.success('Serviço adicionado à tabela');
      }
      resetEntryForm();
      loadEntries();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar preço de serviço');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Remover este serviço da tabela de preços do cliente?'))) return;
    try {
      await api.deleteServicePriceEntry(id);
      toast.success('Removido com sucesso');
      loadEntries();
    } catch (error) {
      toast.error('Erro ao remover');
    }
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const response = await api.downloadServicePriceTablePdf(selectedClient.id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Tabela_Servicos_${selectedClient.name}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="service-price-table-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Tabela de Serviços</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Preços por cliente - usados para preencher automaticamente o Valor do Serviço na emissão de EIR</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none max-w-lg">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cliente</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <Label>Selecione o cliente</Label>
            <Autocomplete
              value={clientNameInput}
              onChange={setClientNameInput}
              options={clients}
              displayField="name"
              onSelect={handleSelectClient}
              className="w-full"
            />
          </CardContent>
        </Card>

        {selectedClient && (
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                <Tags className="w-4 h-4" />
                Serviços de {selectedClient.name}
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf || entries.length === 0}
                data-testid="download-service-price-table-pdf-btn"
              >
                <FileDown className="w-4 h-4 mr-2" />
                Baixar PDF
              </Button>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <form onSubmit={handleSubmitEntry} className="flex items-end gap-2 flex-wrap">
                <div className="w-56">
                  <Label>Serviço</Label>
                  <Autocomplete
                    value={serviceNameInput}
                    onChange={setServiceNameInput}
                    options={serviceTypes}
                    displayField="name"
                    onSelect={(st) => { setSelectedServiceType(st); setServiceNameInput(st.name); }}
                    className="w-full"
                  />
                </div>
                <div className="w-40">
                  <Label>Valor (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={valueInput} onChange={(e) => setValueInput(e.target.value)} className="h-9" />
                </div>
                <Button type="submit" disabled={submitting} data-testid="submit-service-price-entry">
                  <Plus className="w-4 h-4 mr-2" />
                  {editId ? 'Atualizar' : 'Adicionar'}
                </Button>
                {editId && (
                  <Button type="button" variant="outline" onClick={resetEntryForm}>Cancelar</Button>
                )}
              </form>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Serviço</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Valor</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingEntries ? (
                      <tr><td colSpan={3} className="text-center py-6 text-sm text-slate-500">Carregando...</td></tr>
                    ) : entries.length === 0 ? (
                      <tr><td colSpan={3} className="text-center py-6 text-sm text-slate-500">Nenhum serviço cadastrado para este cliente</td></tr>
                    ) : entries.map((entry, idx) => (
                      <tr key={entry.id} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                        <td className="px-4 py-2.5 text-sm text-slate-800 dark:text-slate-200">{entry.service_type_name}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">
                          {entry.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => startEdit(entry)} title="Editar">
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDelete(entry.id)} title="Remover">
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
