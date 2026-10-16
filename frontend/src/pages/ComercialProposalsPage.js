import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, EmptyState, TablePagination, usePagination, StatusPill,
} from '../components/DataPage';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Edit, Trash2, FileText, Printer, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Situação: antigas foram gravadas como "ATIVO" = em aberto
const PROPOSAL_STATUS = {
  EM_ABERTO: { label: 'Em aberto', tone: 'blue' },
  ACEITA: { label: 'Aceita', tone: 'emerald' },
  RECUSADA: { label: 'Recusada', tone: 'red' },
};
const proposalStatus = (p) => (PROPOSAL_STATUS[p.status] ? p.status : 'EM_ABERTO');

// Validade conta a partir da data da proposta; só importa enquanto está em aberto
function validityInfo(p) {
  if (proposalStatus(p) !== 'EM_ABERTO' || !p.created_at) return null;
  const created = new Date(p.created_at);
  const expires = new Date(created.getFullYear(), created.getMonth(), created.getDate() + Number(p.validity_days || 0));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((expires - today) / 86400000);
  if (days < 0) return { tone: 'red', label: 'Vencida' };
  if (days <= 3) return { tone: 'amber', label: days === 0 ? 'Vence hoje' : `Vence em ${days}d` };
  return null;
}

export default function ComercialProposalsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [downloadingId, setDownloadingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [updatingStatus, setUpdatingStatus] = useState(false);

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
      toast.error(error.response?.data?.detail || 'Erro ao excluir proposta');
    }
  };

  const handleStatus = async (proposal, status) => {
    setUpdatingStatus(true);
    try {
      await api.updateCommercialProposalStatus(proposal.id, status);
      toast.success(`Proposta ${proposal.proposal_number}: ${PROPOSAL_STATUS[status].label.toLowerCase()}`);
      loadProposals();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar a situação');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDownloadPdf = async (id, number) => {
    setDownloadingId(id);
    try {
      const response = await api.downloadCommercialProposalPdf(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Proposta_${number || id}.pdf`;
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

  const filteredProposals = proposals.filter(p => (
    (statusFilter === 'ALL' || proposalStatus(p) === statusFilter)
    && (p.proposal_number?.toLowerCase().includes(searchTerm.toLowerCase())
      || p.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()))
  ));
  const { pageItems, paginationProps } = usePagination(filteredProposals, { resetKey: `${searchTerm}|${statusFilter}` });

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = pageItems.map(p => p.id);
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

        <FilterCard hasFilters={!!searchTerm || statusFilter !== 'ALL'} onClear={() => { setSearchTerm(''); setStatusFilter('ALL'); }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Número ou destinatário">
              <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-proposal" />
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="proposal-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="text-sm">Todas</SelectItem>
                  {Object.entries(PROPOSAL_STATUS).map(([value, s]) => (
                    <SelectItem key={value} value={value} className="text-sm">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedItem && handleDownloadPdf(singleSelectedItem.id, singleSelectedItem.proposal_number)} disabled={!singleSelectedItem || downloadingId === singleSelectedItem?.id} />
              <ToolbarButton icon={ThumbsUp} label="Aceita" tone="emerald" onClick={() => singleSelectedItem && handleStatus(singleSelectedItem, 'ACEITA')} disabled={!singleSelectedItem || updatingStatus || proposalStatus(singleSelectedItem) === 'ACEITA'} />
              <ToolbarButton icon={ThumbsDown} label="Recusada" tone="red" onClick={() => singleSelectedItem && handleStatus(singleSelectedItem, 'RECUSADA')} disabled={!singleSelectedItem || updatingStatus || proposalStatus(singleSelectedItem) === 'RECUSADA'} />
              <ToolbarButton icon={RotateCcw} label="Reabrir" tone="blue" onClick={() => singleSelectedItem && handleStatus(singleSelectedItem, 'EM_ABERTO')} disabled={!singleSelectedItem || updatingStatus || proposalStatus(singleSelectedItem) === 'EM_ABERTO'} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)} disabled={!singleSelectedItem} />
            </Toolbar>
          )}
          footer={<TablePagination {...paginationProps} />}
        >
          {loading ? (
            <EmptyState loading />
          ) : filteredProposals.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhuma proposta comercial encontrada"
              hint={(searchTerm || statusFilter !== 'ALL') ? 'Ajuste a busca ou o filtro de Situação' : 'Crie a primeira pelo botão "Nova proposta"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={pageItems.length > 0 && pageItems.every(p => selectedIds.has(p.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Número</th>
                    <th>Destinatário</th>
                    <th className="hidden sm:table-cell">Data</th>
                    <th className="hidden sm:table-cell">Validade</th>
                    <th className="hidden sm:table-cell !text-right">Itens</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((p) => (
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
                      <td className="hidden sm:table-cell whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {p.validity_days} dias
                          {validityInfo(p) && <StatusPill tone={validityInfo(p).tone}>{validityInfo(p).label}</StatusPill>}
                        </span>
                      </td>
                      <td className="hidden sm:table-cell text-right tabular-nums">{(p.items || []).length}</td>
                      <td>
                        <StatusPill tone={PROPOSAL_STATUS[proposalStatus(p)].tone}>{PROPOSAL_STATUS[proposalStatus(p)].label}</StatusPill>
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
