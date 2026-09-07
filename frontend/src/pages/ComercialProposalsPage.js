import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Eye, Edit, Trash2, Search, FileText, Download } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ComercialProposalsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    loadProposals();
  }, []);

  const loadProposals = async () => {
    try {
      const response = await api.getCommercialProposals();
      setProposals(response.data);
    } catch (error) {
      toast.error('Erro ao carregar propostas comerciais');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir esta proposta?'))) return;
    try {
      await api.deleteCommercialProposal(id);
      toast.success('Proposta excluída com sucesso!');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadProposals();
    } catch (error) {
      toast.error('Erro ao excluir proposta');
    }
  };

  const handleDownloadPdf = async (id) => {
    setDownloadingId(id);
    try {
      const response = await api.downloadCommercialProposalPdf(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Proposta_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    } finally {
      setDownloadingId(null);
    }
  };

  const filteredProposals = proposals.filter(p =>
    p.proposal_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredProposals.map(p => p.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedItem = selectedIds.size === 1 ? filteredProposals.find(p => p.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-5" data-testid="commercial-proposals-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Proposta Comercial</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Crie e gerencie propostas comerciais para fechar negócio com clientes</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
              <div className="sm:col-span-2">
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Número ou Destinatário</Label>
                <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-8 text-xs" data-testid="search-proposal" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button variant="ghost" size="sm" onClick={() => navigate('/comercial/proposta/new')} title="Nova Proposta" data-testid="new-proposal-btn" className="h-9 w-9 p-0">
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && navigate(`/comercial/proposta/${singleSelectedItem.id}/edit`)}
            disabled={!singleSelectedItem}
            title="Editar"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Edit className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handleDownloadPdf(singleSelectedItem.id)}
            disabled={!singleSelectedItem || downloadingId === singleSelectedItem?.id}
            title="Baixar PDF"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Download className="w-4 h-4 text-emerald-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)}
            disabled={!singleSelectedItem}
            title="Excluir"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 pl-1 pr-2">
              {selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Propostas ({filteredProposals.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : filteredProposals.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Nenhuma proposta comercial encontrada</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="w-9 px-4 py-2.5">
                        <Checkbox
                          checked={filteredProposals.length > 0 && filteredProposals.every(p => selectedIds.has(p.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Número</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Destinatário</th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Validade</th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Itens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProposals.map((p, idx) => (
                      <tr
                        key={p.id}
                        onClick={() => toggleSelect(p.id)}
                        className={`cursor-pointer transition-colors ${selectedIds.has(p.id) ? 'bg-primary/10 hover:bg-primary/15' : `hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} />
                        </td>
                        <td className="px-4 py-2.5 text-sm font-semibold font-mono text-slate-800 dark:text-slate-200">{p.proposal_number}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{p.recipient_name}</td>
                        <td className="hidden sm:table-cell px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                          {format(new Date(p.created_at), "dd/MM/yyyy", { locale: ptBR })}
                        </td>
                        <td className="hidden sm:table-cell px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">{p.validity_days} dias</td>
                        <td className="hidden sm:table-cell px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">{(p.items || []).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
