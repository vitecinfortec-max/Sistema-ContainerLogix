import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { ArrowLeft, Plus, Trash2, Edit, Tags, FileDown } from 'lucide-react';

const CURRENCY_OPTIONS = [['BRL', 'R$ - Real'], ['USD', '$ - Dólar']];
const CURRENCY_SYMBOL = { BRL: 'R$', USD: '$' };
const formatMoney = (value, currency) => `${CURRENCY_SYMBOL[currency] || currency} ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BILLING_TYPE_OPTIONS = [['UNICO', 'Único'], ['DIARIA', 'Diária de Armazenagem']];
const SIZE_GROUP_OPTIONS = [['_any', 'Qualquer tamanho'], ['20', '20 pés'], ['40', '40 pés']];

export default function ServicePriceTableClientPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();

  const [clientName, setClientName] = useState('');
  const [loading, setLoading] = useState(true);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [entries, setEntries] = useState([]);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const [serviceNameInput, setServiceNameInput] = useState('');
  const [selectedServiceType, setSelectedServiceType] = useState(null);
  const [valueInput, setValueInput] = useState('');
  const [currency, setCurrency] = useState('BRL');
  const [billingType, setBillingType] = useState('UNICO');
  const [freeTimeDays, setFreeTimeDays] = useState('');
  const [sizeGroup, setSizeGroup] = useState('_any');
  const [editId, setEditId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [clientsRes, serviceTypesRes, entriesRes] = await Promise.all([
        api.getClients(), api.getServiceTypes(), api.getServicePriceEntries({ client_id: clientId }),
      ]);
      const client = (clientsRes.data || []).find(c => c.id === clientId);
      setClientName(client ? client.name : '');
      setServiceTypes(Array.isArray(serviceTypesRes.data) ? serviceTypesRes.data : []);
      setEntries(entriesRes.data);
    } catch (error) {
      toast.error('Erro ao carregar tabela de serviços do cliente');
    } finally {
      setLoading(false);
    }
  };

  const loadEntries = async () => {
    try {
      const response = await api.getServicePriceEntries({ client_id: clientId });
      setEntries(response.data);
    } catch (error) {
      toast.error('Erro ao carregar tabela de serviços do cliente');
    }
  };

  const resetEntryForm = () => {
    setServiceNameInput('');
    setSelectedServiceType(null);
    setValueInput('');
    setCurrency('BRL');
    setBillingType('UNICO');
    setFreeTimeDays('');
    setSizeGroup('_any');
    setEditId(null);
  };

  const startEdit = (entry) => {
    setEditId(entry.id);
    setServiceNameInput(entry.service_type_name);
    setSelectedServiceType({ id: entry.service_type_id, name: entry.service_type_name });
    setValueInput(String(entry.value));
    setCurrency(entry.currency || 'BRL');
    setBillingType(entry.billing_type || 'UNICO');
    setFreeTimeDays(entry.free_time_days != null ? String(entry.free_time_days) : '');
    setSizeGroup(entry.container_size_group || '_any');
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
    if (billingType === 'DIARIA' && (freeTimeDays === '' || Number(freeTimeDays) < 0)) {
      toast.error('Informe o Free Time (dias) para a Diária de Armazenagem');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        client_id: clientId,
        service_type_id: selectedServiceType.id,
        value: Number(valueInput),
        currency,
        billing_type: billingType,
        free_time_days: billingType === 'DIARIA' ? Number(freeTimeDays) : null,
        container_size_group: billingType === 'DIARIA' && sizeGroup !== '_any' ? sizeGroup : null,
      };
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
      const response = await api.downloadServicePriceTablePdf(clientId);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Tabela_Servicos_${clientName}.pdf`;
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

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="service-price-table-client-page">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate('/comercial/tabela-servicos')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">{clientName || 'Cliente'}</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Tabela de Serviços</p>
          </div>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Tags className="w-4 h-4" />
              Serviços de {clientName}
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
              <div className="w-32">
                <Label>{billingType === 'DIARIA' ? 'Valor da Diária' : 'Valor'} ({CURRENCY_SYMBOL[currency]})</Label>
                <Input type="number" step="0.01" min="0" value={valueInput} onChange={(e) => setValueInput(e.target.value)} className="h-9" />
              </div>
              <div className="w-36">
                <Label>Moeda</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-48">
                <Label>Tipo de Cobrança</Label>
                <Select value={billingType} onValueChange={setBillingType}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BILLING_TYPE_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {billingType === 'DIARIA' && (
                <>
                  <div className="w-32">
                    <Label>Free Time (dias)</Label>
                    <Input type="number" step="1" min="0" value={freeTimeDays} onChange={(e) => setFreeTimeDays(e.target.value)} className="h-9" />
                  </div>
                  <div className="w-40">
                    <Label>Tamanho do Container</Label>
                    <Select value={sizeGroup} onValueChange={setSizeGroup}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SIZE_GROUP_OPTIONS.map(([value, label]) => (
                          <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
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
                  {entries.length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-6 text-sm text-slate-500">Nenhum serviço cadastrado para este cliente</td></tr>
                  ) : entries.map((entry, idx) => (
                    <tr key={entry.id} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                      <td className="px-4 py-2.5 text-sm text-slate-800 dark:text-slate-200">{entry.service_type_name}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">
                        {entry.billing_type === 'DIARIA' ? (
                          <div>
                            <div>{formatMoney(entry.value, entry.currency || 'BRL')}/dia</div>
                            <div className="text-xs text-slate-400 dark:text-slate-500">
                              Free time {entry.free_time_days} dias · {entry.container_size_group ? `${entry.container_size_group} pés` : 'qualquer tamanho'}
                            </div>
                          </div>
                        ) : (
                          formatMoney(entry.value, entry.currency || 'BRL')
                        )}
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
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
