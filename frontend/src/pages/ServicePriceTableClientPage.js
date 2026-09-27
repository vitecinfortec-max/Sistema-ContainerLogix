import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { FilterField, DataCard, StatusPill, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
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
        api.getClients(), api.getServiceTypes({ per_page: 1000 }), api.getServicePriceEntries({ client_id: clientId }),
      ]);
      const client = (clientsRes.data || []).find(c => c.id === clientId);
      setClientName(client ? client.name : '');
      setServiceTypes(Array.isArray(serviceTypesRes.data?.items) ? serviceTypesRes.data.items : []);
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
      <div className="space-y-4" data-testid="service-price-table-client-page">
        <PageHeader
          icon={Tags}
          title={clientName || 'Cliente'}
          subtitle="Tabela de Serviços"
          actions={(
            <>
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => navigate('/comercial/tabela-servicos')}>
                <ArrowLeft className="w-4 h-4" /> Voltar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf || entries.length === 0}
                data-testid="download-service-price-table-pdf-btn"
              >
                <FileDown className="w-4 h-4 text-red-600" /> Baixar PDF
              </Button>
            </>
          )}
        />

        <DataCard title={editId ? 'Editar serviço' : 'Adicionar serviço'}>
          <form onSubmit={handleSubmitEntry} className="p-4 flex items-end gap-3 flex-wrap">
            <FilterField label="Serviço" className="w-56">
              <Autocomplete
                value={serviceNameInput}
                onChange={setServiceNameInput}
                options={serviceTypes}
                displayField="name"
                onSelect={(st) => { setSelectedServiceType(st); setServiceNameInput(st.name); }}
                className="w-full text-sm"
              />
            </FilterField>
            <FilterField label={`${billingType === 'DIARIA' ? 'Valor da diária' : 'Valor'} (${CURRENCY_SYMBOL[currency]})`} className="w-32">
              <Input type="number" step="0.01" min="0" value={valueInput} onChange={(e) => setValueInput(e.target.value)} className="h-9 text-sm" />
            </FilterField>
            <FilterField label="Moeda" className="w-36">
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Tipo de cobrança" className="w-48">
              <Select value={billingType} onValueChange={setBillingType}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_TYPE_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            {billingType === 'DIARIA' && (
              <>
                <FilterField label="Free time (dias)" className="w-32">
                  <Input type="number" step="1" min="0" value={freeTimeDays} onChange={(e) => setFreeTimeDays(e.target.value)} className="h-9 text-sm" />
                </FilterField>
                <FilterField label="Tamanho do container" className="w-40">
                  <Select value={sizeGroup} onValueChange={setSizeGroup}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SIZE_GROUP_OPTIONS.map(([value, label]) => (
                        <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
              </>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={submitting} className="h-9 gap-1.5" data-testid="submit-service-price-entry">
                <Plus className="w-4 h-4" />
                {editId ? 'Atualizar' : 'Adicionar'}
              </Button>
              {editId && (
                <Button type="button" variant="outline" className="h-9" onClick={resetEntryForm}>Cancelar</Button>
              )}
            </div>
          </form>
        </DataCard>

        <DataCard title={`Serviços de ${clientName || 'cliente'}`} count={entries.length}>
          {entries.length === 0 ? (
            <EmptyState icon={Tags} title="Nenhum serviço cadastrado para este cliente" hint="Use o card acima para adicionar o primeiro preço" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Serviço</th>
                    <th>Cobrança</th>
                    <th className="!text-right">Valor</th>
                    <th className="w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} data-selected={editId === entry.id}>
                      <td className="cell-strong"><div className="max-w-[360px] truncate" title={entry.service_type_name}>{entry.service_type_name}</div></td>
                      <td>
                        {entry.billing_type === 'DIARIA' ? (
                          <div className="flex flex-col gap-0.5">
                            <StatusPill tone="violet" dot={false} className="w-fit">Diária de armazenagem</StatusPill>
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                              Free time {entry.free_time_days} dias · {entry.container_size_group ? `${entry.container_size_group} pés` : 'qualquer tamanho'}
                            </span>
                          </div>
                        ) : (
                          <StatusPill tone="slate" dot={false}>Único</StatusPill>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        {formatMoney(entry.value, entry.currency || 'BRL')}{entry.billing_type === 'DIARIA' ? '/dia' : ''}
                      </td>
                      <td className="!py-1">
                        <div className="flex items-center justify-end gap-1">
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
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
