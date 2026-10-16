import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { FilterField, DataCard, StatusPill, EmptyState, TablePagination, usePagination } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';

const STATUS_OPTIONS = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo']];
const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtUSD = (v) => Number(v || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
import { Plus, Trash2, Edit, Link2, FileDown } from 'lucide-react';

function CommissionPreview({ data, loading }) {
  const reps = data.representatives || [];
  const hasUsd = reps.some((r) => (r.clients || []).some((c) => c.total_billed_usd));
  if (!loading && reps.length === 0) {
    return <EmptyState icon={FileDown} title="Nenhum vínculo ativo com comissão" hint="Vincule um cliente a um representante acima" />;
  }
  return (
    <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800" data-testid="commission-preview">
      <table className="data-table">
        <thead>
          <tr>
            <th>Representante / Cliente</th>
            <th className="!text-right">Comissão (%)</th>
            <th className="!text-right">Faturado R$</th>
            <th className="!text-right">Comissão R$</th>
            {hasUsd && <th className="!text-right">Faturado US$</th>}
            {hasUsd && <th className="!text-right">Comissão US$</th>}
          </tr>
        </thead>
        <tbody>
          {reps.map((rep) => [
            <tr key={`${rep.representative_name}-h`} className="bg-slate-50/70 dark:bg-slate-800/40">
              <td className="cell-strong">{rep.representative_name}</td>
              <td />
              <td />
              <td className="text-right tabular-nums font-semibold">{fmtBRL(rep.total_commission)}</td>
              {hasUsd && <td />}
              {hasUsd && <td className="text-right tabular-nums font-semibold">{fmtUSD(rep.total_commission_usd)}</td>}
            </tr>,
            ...(rep.clients || []).map((c) => (
              <tr key={`${rep.representative_name}-${c.client_name}`}>
                <td className="pl-8">
                  <div className="max-w-[300px] truncate" title={c.client_name}>{c.client_name}</div>
                  {c.has_price_table === false && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">sem Tabela de Serviços: não gera comissão</span>
                  )}
                </td>
                <td className="text-right tabular-nums">{String(c.commission_percentage).replace('.', ',')}%</td>
                <td className="text-right tabular-nums">{fmtBRL(c.total_billed)}</td>
                <td className="text-right tabular-nums">{fmtBRL(c.commission_value)}</td>
                {hasUsd && <td className="text-right tabular-nums">{fmtUSD(c.total_billed_usd)}</td>}
                {hasUsd && <td className="text-right tabular-nums">{fmtUSD(c.commission_value_usd)}</td>}
              </tr>
            )),
          ])}
          <tr>
            <td className="cell-strong">Total geral</td>
            <td />
            <td />
            <td className="text-right tabular-nums font-semibold text-primary">{fmtBRL(data.grand_total)}</td>
            {hasUsd && <td />}
            {hasUsd && <td className="text-right tabular-nums font-semibold text-primary">{fmtUSD(data.grand_total_usd)}</td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ClientRepresentativeLinksPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [clients, setClients] = useState([]);
  const [representatives, setRepresentatives] = useState([]);
  const [links, setLinks] = useState([]);
  const { pageItems, paginationProps } = usePagination(links);
  const [loading, setLoading] = useState(true);

  const [clientNameInput, setClientNameInput] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [repNameInput, setRepNameInput] = useState('');
  const [selectedRep, setSelectedRep] = useState(null);
  const [percentageInput, setPercentageInput] = useState('');
  const [editId, setEditId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [reportRepNameInput, setReportRepNameInput] = useState('');
  const [reportRep, setReportRep] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [linkStatus, setLinkStatus] = useState('ATIVO');
  const [commission, setCommission] = useState(null);
  const [loadingCommission, setLoadingCommission] = useState(false);
  const periodError = startDate && endDate && startDate > endDate ? 'A data inicial não pode ser depois da data final.' : '';

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [clientsRes, repsRes, linksRes] = await Promise.all([
        api.getClients(), api.getRepresentatives(), api.getClientRepresentativeLinks(),
      ]);
      setClients(Array.isArray(clientsRes.data) ? clientsRes.data : []);
      setRepresentatives(Array.isArray(repsRes.data) ? repsRes.data : []);
      setLinks(linksRes.data);
    } catch (error) {
      toast.error('Erro ao carregar vínculos');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setClientNameInput('');
    setSelectedClient(null);
    setRepNameInput('');
    setSelectedRep(null);
    setPercentageInput('');
    setLinkStatus('ATIVO');
    setEditId(null);
  };

  const startEdit = (link) => {
    setEditId(link.id);
    setClientNameInput(link.client_name);
    setSelectedClient({ id: link.client_id, name: link.client_name });
    setRepNameInput(link.representative_name);
    setSelectedRep({ id: link.representative_id, name: link.representative_name });
    setPercentageInput(String(link.commission_percentage));
    setLinkStatus(link.status || 'ATIVO');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Nome digitado e não escolhido na lista: não salva o cliente/representante anterior
    if (!selectedClient || !selectedRep || selectedClient.name !== clientNameInput || selectedRep.name !== repNameInput) {
      toast.error('Selecione o cliente e o representante na lista');
      return;
    }
    if (percentageInput === '' || Number(percentageInput) < 0 || Number(percentageInput) > 100) {
      toast.error('Informe um percentual de comissão entre 0 e 100');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { client_id: selectedClient.id, representative_id: selectedRep.id, commission_percentage: Number(percentageInput), status: linkStatus };
      if (editId) {
        await api.updateClientRepresentativeLink(editId, payload);
        toast.success('Vínculo atualizado com sucesso');
      } else {
        await api.createClientRepresentativeLink(payload);
        toast.success('Vínculo cadastrado com sucesso');
      }
      resetForm();
      loadAll();
      loadCommission();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar vínculo');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Remover este vínculo?'))) return;
    try {
      await api.deleteClientRepresentativeLink(id);
      toast.success('Vínculo removido com sucesso');
      loadAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao remover vínculo');
    }
  };

  const reportParams = () => {
    const params = {};
    if (reportRep) params.representative_id = reportRep.id;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return params;
  };

  // Prévia na tela: os mesmos números do PDF, recalculada a cada filtro
  const loadCommission = async () => {
    if (periodError) {
      setCommission(null);
      return;
    }
    setLoadingCommission(true);
    try {
      const response = await api.getCommissionReport(reportParams());
      setCommission(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao calcular a comissão');
    } finally {
      setLoadingCommission(false);
    }
  };

  useEffect(() => {
    loadCommission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportRep, startDate, endDate]);

  const handleDownloadReport = async () => {
    if (periodError) {
      toast.error(periodError);
      return;
    }
    setGeneratingReport(true);
    try {
      const response = await api.downloadCommissionReportPdf(reportParams());
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Relatorio_Comissao.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao gerar relatório de comissão');
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="client-representative-links-page">
        <PageHeader
          icon={Link2}
          title="Vínculo de Clientes"
          subtitle="Vincule clientes a representantes comerciais com o percentual de comissão de cada um"
        />

        <DataCard title={editId ? 'Editar vínculo' : 'Novo vínculo'}>
          <form onSubmit={handleSubmit} className="p-4 flex items-end gap-3 flex-wrap">
            <FilterField label="Cliente" className="w-64">
              <Autocomplete
                value={clientNameInput}
                onChange={setClientNameInput}
                options={clients}
                displayField="name"
                onSelect={(c) => { setSelectedClient(c); setClientNameInput(c.name); }}
                className="w-full text-sm"
              />
            </FilterField>
            <FilterField label="Representante" className="w-64">
              <Autocomplete
                value={repNameInput}
                onChange={setRepNameInput}
                options={representatives}
                displayField="name"
                onSelect={(r) => { setSelectedRep(r); setRepNameInput(r.name); }}
                className="w-full text-sm"
              />
            </FilterField>
            <FilterField label="Comissão (%)" className="w-36">
              <Input type="number" step="0.01" min="0" max="100" value={percentageInput} onChange={(e) => setPercentageInput(e.target.value)} className="h-9 text-sm" />
            </FilterField>
            <FilterField label="Status" className="w-32">
              <Select value={linkStatus} onValueChange={setLinkStatus}>
                <SelectTrigger className="h-9 text-sm" data-testid="client-rep-link-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={submitting} className="h-9 gap-1.5" data-testid="submit-client-rep-link">
                <Plus className="w-4 h-4" />
                {editId ? 'Atualizar' : 'Vincular'}
              </Button>
              {editId && <Button type="button" variant="outline" className="h-9" onClick={resetForm}>Cancelar</Button>}
            </div>
          </form>
        </DataCard>

        <DataCard title="Vínculos" count={loading ? '...' : links.length} footer={<TablePagination {...paginationProps} />}>
          {loading ? (
            <EmptyState loading />
          ) : links.length === 0 ? (
            <EmptyState icon={Link2} title="Nenhum vínculo cadastrado" hint="Use o card acima para vincular um cliente a um representante" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Representante</th>
                    <th className="!text-right">Comissão</th>
                    <th>Status</th>
                    <th className="w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((link) => (
                    <tr key={link.id} data-selected={editId === link.id}>
                      <td className="cell-strong"><div className="max-w-[300px] truncate" title={link.client_name}>{link.client_name}</div></td>
                      <td><div className="max-w-[240px] truncate" title={link.representative_name}>{link.representative_name}</div></td>
                      <td className="text-right tabular-nums">{link.commission_percentage}%</td>
                      <td>
                        <StatusPill tone={link.status === 'ATIVO' ? 'emerald' : 'slate'}>
                          {link.status === 'ATIVO' ? 'Ativo' : 'Inativo'}
                        </StatusPill>
                      </td>
                      <td className="!py-1">
                        <div className="flex items-center justify-end gap-1">
                          <Button aria-label="Editar" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => startEdit(link)} title="Editar">
                            <Edit className="w-3.5 h-3.5 text-blue-600" />
                          </Button>
                          <Button aria-label="Remover" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDelete(link.id)} title="Remover">
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

        <DataCard title={(<span className="flex items-center gap-2"><FileDown className="w-4 h-4 text-primary" />Relatório de comissão</span>)}>
          <div className="p-4">
            <div className="flex items-end gap-3 flex-wrap">
              <FilterField label="Representante (opcional)" className="w-64">
                <Autocomplete
                  value={reportRepNameInput}
                  onChange={(v) => { setReportRepNameInput(v); if (!v || (reportRep && v !== reportRep.name)) setReportRep(null); }}
                  options={representatives}
                  displayField="name"
                  onSelect={(r) => { setReportRep(r); setReportRepNameInput(r.name); }}
                  className="w-full text-sm"
                />
              </FilterField>
              <FilterField label="Data inicial">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
              </FilterField>
              <FilterField label="Data final">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-sm" />
              </FilterField>
              <Button variant="outline" onClick={handleDownloadReport} disabled={generatingReport} className="h-9 gap-1.5" data-testid="download-commission-report-btn">
                <FileDown className="w-4 h-4 text-red-600" />
                Baixar PDF
              </Button>
            </div>
            {periodError ? (
              <p className="text-[12px] text-red-600 dark:text-red-400 mt-3" data-testid="commission-period-error">{periodError}</p>
            ) : (
              <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-3">
                A comissão é calculada apenas sobre movimentações já faturadas dentro do período informado (dias no horário de Brasília), e só dos serviços que o cliente tem na Tabela de Serviços.
              </p>
            )}
          </div>
          {commission && (
            <CommissionPreview data={commission} loading={loadingCommission} />
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
