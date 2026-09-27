import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { FilterField, DataCard, StatusPill, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Edit, Link2, FileDown } from 'lucide-react';

export default function ClientRepresentativeLinksPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [clients, setClients] = useState([]);
  const [representatives, setRepresentatives] = useState([]);
  const [links, setLinks] = useState([]);
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
    setEditId(null);
  };

  const startEdit = (link) => {
    setEditId(link.id);
    setClientNameInput(link.client_name);
    setSelectedClient({ id: link.client_id, name: link.client_name });
    setRepNameInput(link.representative_name);
    setSelectedRep({ id: link.representative_id, name: link.representative_name });
    setPercentageInput(String(link.commission_percentage));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedClient || !selectedRep) {
      toast.error('Selecione o cliente e o representante');
      return;
    }
    if (percentageInput === '' || Number(percentageInput) < 0) {
      toast.error('Informe um percentual de comissão válido');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { client_id: selectedClient.id, representative_id: selectedRep.id, commission_percentage: Number(percentageInput) };
      if (editId) {
        await api.updateClientRepresentativeLink(editId, payload);
        toast.success('Vínculo atualizado com sucesso');
      } else {
        await api.createClientRepresentativeLink(payload);
        toast.success('Vínculo cadastrado com sucesso');
      }
      resetForm();
      loadAll();
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
      toast.error('Erro ao remover vínculo');
    }
  };

  const handleDownloadReport = async () => {
    setGeneratingReport(true);
    try {
      const params = {};
      if (reportRep) params.representative_id = reportRep.id;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const response = await api.downloadCommissionReportPdf(params);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Relatorio_Comissao.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar relatório de comissão');
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
              <Input type="number" step="0.01" min="0" value={percentageInput} onChange={(e) => setPercentageInput(e.target.value)} className="h-9 text-sm" />
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

        <DataCard title="Vínculos" count={loading ? '...' : links.length}>
          {loading ? (
            <EmptyState title="Carregando..." />
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
                  {links.map((link) => (
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
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => startEdit(link)} title="Editar">
                            <Edit className="w-3.5 h-3.5 text-blue-600" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDelete(link.id)} title="Remover">
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
                  onChange={(v) => { setReportRepNameInput(v); if (!v) setReportRep(null); }}
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
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-3">
              A comissão é calculada apenas sobre movimentações já faturadas dentro do período informado.
            </p>
          </div>
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
