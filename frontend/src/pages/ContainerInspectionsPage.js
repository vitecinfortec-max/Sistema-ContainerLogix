import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, UserTag, EmptyState, TablePagination,
} from '../components/DataPage';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Eye, Printer, Trash2, ClipboardCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ContainerInspectionsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: 20,
    total: 0,
    totalPages: 0
  });

  useEffect(() => {
    loadInspections();
  }, [pagination.page]);

  const loadInspections = async () => {
    try {
      const response = await api.getContainerInspections({
        page: pagination.page,
        per_page: pagination.perPage
      });
      setInspections(response.data.items);
      setPagination(prev => ({
        ...prev,
        total: response.data.total,
        totalPages: response.data.total_pages
      }));
    } catch (error) {
      toast.error('Erro ao carregar registros');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir este registro?'))) return;

    try {
      await api.deleteContainerInspection(id);
      toast.success('Registro excluído com sucesso!');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadInspections();
    } catch (error) {
      toast.error('Erro ao excluir registro');
    }
  };

  const getPhotoCount = (inspection) => (inspection.photos || []).length;

  const filteredInspections = inspections.filter(i =>
    i.container_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.booking?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredInspections.map(i => i.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedItem = selectedIds.size === 1 ? filteredInspections.find(i => i.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="container-inspections-page">
        <PageHeader
          icon={ClipboardCheck}
          title="Registro Fotográfico"
          subtitle="Gerenciamento de registros fotográficos de containers"
        />

        <FilterCard hasFilters={!!searchTerm} onClear={() => setSearchTerm('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Container, booking ou cliente" className="sm:col-span-2">
              <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-inspection" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um registro pra habilitar as ações da barra */}
        <DataCard
          title="Registros"
          count={pagination.total.toLocaleString('pt-BR')}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo registro" onClick={() => navigate('/container-inspections/new')} testId="new-inspection-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedItem && navigate(`/container-inspections/${singleSelectedItem.id}`)} disabled={!singleSelectedItem} testId="view-inspection-button" />
              <ToolbarButton icon={Printer} label="Imprimir" tone="emerald" onClick={() => singleSelectedItem && navigate(`/container-inspections/${singleSelectedItem.id}?print=true`)} disabled={!singleSelectedItem} testId="print-inspection-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)} disabled={!singleSelectedItem} testId="delete-inspection-button" />
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
          ) : filteredInspections.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="Nenhum registro fotográfico encontrado" hint="Ajuste a busca ou crie um novo registro" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredInspections.length > 0 && filteredInspections.every(i => selectedIds.has(i.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Container</th>
                    <th>Cliente</th>
                    <th className="hidden sm:table-cell">Fotos</th>
                    <th className="hidden sm:table-cell">Criado em</th>
                    <th className="hidden sm:table-cell">Criado por</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInspections.map((inspection) => (
                    <tr
                      key={inspection.id}
                      onClick={() => toggleSelect(inspection.id)}
                      data-selected={selectedIds.has(inspection.id)}
                      className="cursor-pointer"
                      data-testid={`inspection-row-${inspection.id}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(inspection.id)}
                          onCheckedChange={() => toggleSelect(inspection.id)}
                          data-testid="inspection-row-checkbox"
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{inspection.inspection_number}</td>
                      <td className="font-mono whitespace-nowrap text-slate-700 dark:text-slate-200">{inspection.container_number}</td>
                      <td><div className="max-w-[260px] truncate" title={inspection.client_name || ''}>{inspection.client_name || '-'}</div></td>
                      <td className="hidden sm:table-cell">
                        <StatusPill tone={getPhotoCount(inspection) > 0 ? 'emerald' : 'slate'}>{getPhotoCount(inspection)}/8</StatusPill>
                      </td>
                      <td className="hidden sm:table-cell whitespace-nowrap tabular-nums">
                        {format(new Date(inspection.created_at), 'dd/MM/yyyy', { locale: ptBR })}{' '}
                        <span className="text-slate-400 dark:text-slate-500">{format(new Date(inspection.created_at), 'HH:mm', { locale: ptBR })}</span>
                      </td>
                      <td className="hidden sm:table-cell"><UserTag name={inspection.created_by_name} /></td>
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
