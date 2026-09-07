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
      <div className="space-y-5" data-testid="client-representative-links-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Vínculo de Clientes</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Vincule clientes a representantes comerciais com o percentual de comissão de cada um</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Link2 className="w-4 h-4" />
              Vínculos ({links.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <form onSubmit={handleSubmit} className="flex items-end gap-2 flex-wrap">
              <div className="w-56">
                <Label>Cliente</Label>
                <Autocomplete
                  value={clientNameInput}
                  onChange={setClientNameInput}
                  options={clients}
                  displayField="name"
                  onSelect={(c) => { setSelectedClient(c); setClientNameInput(c.name); }}
                  className="w-full"
                />
              </div>
              <div className="w-56">
                <Label>Representante</Label>
                <Autocomplete
                  value={repNameInput}
                  onChange={setRepNameInput}
                  options={representatives}
                  displayField="name"
                  onSelect={(r) => { setSelectedRep(r); setRepNameInput(r.name); }}
                  className="w-full"
                />
              </div>
              <div className="w-36">
                <Label>Comissão (%)</Label>
                <Input type="number" step="0.01" min="0" value={percentageInput} onChange={(e) => setPercentageInput(e.target.value)} className="h-9" />
              </div>
              <Button type="submit" disabled={submitting} data-testid="submit-client-rep-link">
                <Plus className="w-4 h-4 mr-2" />
                {editId ? 'Atualizar' : 'Vincular'}
              </Button>
              {editId && <Button type="button" variant="outline" onClick={resetForm}>Cancelar</Button>}
            </form>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Representante</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Comissão</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="text-center py-6 text-sm text-slate-500">Carregando...</td></tr>
                  ) : links.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-6 text-sm text-slate-500">Nenhum vínculo cadastrado</td></tr>
                  ) : links.map((link, idx) => (
                    <tr key={link.id} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                      <td className="px-4 py-2.5 text-sm text-slate-800 dark:text-slate-200">{link.client_name}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{link.representative_name}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{link.commission_percentage}%</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${link.status === 'ATIVO' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                          {link.status === 'ATIVO' ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
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
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Relatório de Comissão</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="w-56">
                <Label>Representante (opcional)</Label>
                <Autocomplete
                  value={reportRepNameInput}
                  onChange={(v) => { setReportRepNameInput(v); if (!v) setReportRep(null); }}
                  options={representatives}
                  displayField="name"
                  onSelect={(r) => { setReportRep(r); setReportRepNameInput(r.name); }}
                  className="w-full"
                />
              </div>
              <div>
                <Label>Data Inicial</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" />
              </div>
              <div>
                <Label>Data Final</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9" />
              </div>
              <Button onClick={handleDownloadReport} disabled={generatingReport} data-testid="download-commission-report-btn">
                <FileDown className="w-4 h-4 mr-2" />
                Baixar PDF
              </Button>
            </div>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-3">
              A comissão é calculada apenas sobre movimentações já faturadas dentro do período informado.
            </p>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
