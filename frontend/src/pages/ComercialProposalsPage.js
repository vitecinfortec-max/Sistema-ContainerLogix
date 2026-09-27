import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, EmptyState,
} from '../components/DataPage';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Edit, Trash2, FileText, Printer } from 'lucide-react';
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
      <div className="space-y-4" data-testid="commercial-proposals-page">
        <PageHeader icon={FileText} title="Proposta Comercial" subtitle="Crie e gerencie propostas comerciais para fechar negócio com clientes" />

        <FilterCard hasFilters={!!searchTerm} onClear={() => setSearchTerm('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Número ou destinatário">
              <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-proposal" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma proposta pra habilitar as ações da barra */}
        <DataCard
          title="Propostas"
          count={loading ? '...' : filteredProposals.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova proposta" onClick={() => navigate('/comercial/proposta/new')} testId="new-proposal-btn" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedItem && navigate(`/comercial/proposta/${singleSelectedItem.id}/edit`)} disabled={!singleSelectedItem} />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedItem && handleDownloadPdf(singleSelectedItem.id)} disabled={!singleSelectedItem || downloadingId === singleSelectedItem?.id} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)} disabled={!singleSelectedItem} />
            </Toolbar>
          )}
        >
          {loading ? (
            <EmptyState title="Carregando..." />
          ) : filteredProposals.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhuma proposta comercial encontrada"
              hint={searchTerm ? 'Ajuste a busca' : 'Crie a primeira pelo botão "Nova proposta"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredProposals.length > 0 && filteredProposals.every(p => selectedIds.has(p.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Número</th>
                    <th>Destinatário</th>
                    <th className="hidden sm:table-cell">Data</th>
                    <th className="hidden sm:table-cell">Validade</th>
                    <th className="hidden sm:table-cell !text-right">Itens</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProposals.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => toggleSelect(p.id)}
                      data-selected={selectedIds.has(p.id)}
                      className="cursor-pointer"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">{p.proposal_number}</td>
                      <td><div className="max-w-[320px] truncate" title={p.recipient_name || ''}>{p.recipient_name}</div></td>
                      <td className="hidden sm:table-cell whitespace-nowrap tabular-nums">
                        {format(new Date(p.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </td>
                      <td className="hidden sm:table-cell whitespace-nowrap">{p.validity_days} dias</td>
                      <td className="hidden sm:table-cell text-right tabular-nums">{(p.items || []).length}</td>
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
