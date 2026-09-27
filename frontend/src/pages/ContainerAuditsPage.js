import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Eye, Trash2, ListChecks } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_TONES = {
  EM_ANDAMENTO: 'amber',
  CONCLUIDA: 'emerald',
};
const STATUS_LABELS = {
  EM_ANDAMENTO: 'Em Andamento',
  CONCLUIDA: 'Concluída',
};

export default function ContainerAuditsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pagination, setPagination] = useState({ page: 1, perPage: 20, total: 0, totalPages: 0 });

  useEffect(() => {
    loadAudits();
  }, [pagination.page]);

  const loadAudits = async () => {
    try {
      const response = await api.getContainerAudits({ page: pagination.page, per_page: pagination.perPage });
      setAudits(response.data.items);
      setPagination(prev => ({ ...prev, total: response.data.total, totalPages: response.data.total_pages }));
    } catch (error) {
      toast.error('Erro ao carregar auditorias');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir esta auditoria?'))) return;
    try {
      await api.deleteContainerAudit(id);
      toast.success('Auditoria excluída com sucesso!');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadAudits();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao excluir auditoria');
    }
  };

  const getDivergenceCount = (audit) => (audit.items || []).filter(i => i.status === 'FALTANTE' || i.status === 'NAO_ESPERADO').length;

  const filteredAudits = audits.filter(a =>
    a.audit_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredAudits.map(a => a.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedItem = selectedIds.size === 1 ? filteredAudits.find(a => a.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="container-audits-page">
        <PageHeader
          icon={ListChecks}
          title="Auditoria de Estoque"
          subtitle="Confronto entre o estoque do sistema e o que foi encontrado fisicamente no pátio"
        />

        <FilterCard hasFilters={!!searchTerm} onClear={() => setSearchTerm('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Código ou cliente" className="sm:col-span-2">
              <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-audit" />
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Auditorias"
          count={pagination.total.toLocaleString('pt-BR')}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova auditoria" onClick={() => navigate('/container-audits/new')} testId="new-audit-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedItem && navigate(`/container-audits/${singleSelectedItem.id}`)} disabled={!singleSelectedItem} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)} disabled={!singleSelectedItem || singleSelectedItem.status === 'CONCLUIDA'} />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              pageSize={pagination.perPage}
              onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState title="Carregando..." />
          ) : filteredAudits.length === 0 ? (
            <EmptyState icon={ListChecks} title="Nenhuma auditoria encontrada" hint="Ajuste a busca ou inicie uma nova auditoria" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredAudits.length > 0 && filteredAudits.every(a => selectedIds.has(a.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Código</th>
                    <th>Cliente</th>
                    <th className="hidden sm:table-cell">Data</th>
                    <th>Status</th>
                    <th className="hidden sm:table-cell">Divergências</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAudits.map((audit) => (
                    <tr
                      key={audit.id}
                      onClick={() => toggleSelect(audit.id)}
                      data-selected={selectedIds.has(audit.id)}
                      className="cursor-pointer"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(audit.id)} onCheckedChange={() => toggleSelect(audit.id)} />
                      </td>
                      <td className="cell-strong font-mono whitespace-nowrap">{audit.audit_code}</td>
                      <td><div className="max-w-[300px] truncate" title={audit.client_name || ''}>{audit.client_name}</div></td>
                      <td className="hidden sm:table-cell whitespace-nowrap tabular-nums">
                        {format(new Date(audit.created_at), 'dd/MM/yyyy', { locale: ptBR })}{' '}
                        <span className="text-slate-400 dark:text-slate-500">{format(new Date(audit.created_at), 'HH:mm', { locale: ptBR })}</span>
                      </td>
                      <td>
                        <StatusPill tone={STATUS_TONES[audit.status] || 'amber'}>{STATUS_LABELS[audit.status] || audit.status}</StatusPill>
                      </td>
                      <td className="hidden sm:table-cell">
                        {getDivergenceCount(audit) > 0 ? (
                          <StatusPill tone="red">{getDivergenceCount(audit)}</StatusPill>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
                        )}
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
