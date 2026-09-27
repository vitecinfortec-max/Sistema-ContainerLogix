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
import { Plus, Eye, Printer, Trash2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ContainerVistoriasPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [vistorias, setVistorias] = useState([]);
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
    loadVistorias();
  }, [pagination.page]);

  const loadVistorias = async () => {
    try {
      const response = await api.getContainerVistorias({
        page: pagination.page,
        per_page: pagination.perPage
      });
      setVistorias(response.data.items);
      setPagination(prev => ({
        ...prev,
        total: response.data.total,
        totalPages: response.data.total_pages
      }));
    } catch (error) {
      toast.error('Erro ao carregar vistorias');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir esta vistoria?'))) return;

    try {
      await api.deleteContainerVistoria(id);
      toast.success('Vistoria excluída com sucesso!');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadVistorias();
    } catch (error) {
      toast.error('Erro ao excluir vistoria');
    }
  };

  const getPhotoCount = (vistoria) => (vistoria.photos || []).length;

  const filteredVistorias = vistorias.filter(v =>
    v.container_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredVistorias.map(v => v.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedItem = selectedIds.size === 1 ? filteredVistorias.find(v => v.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="container-vistorias-page">
        <PageHeader
          icon={ShieldCheck}
          title="Vistoria de Container"
          subtitle="Gerenciamento de vistorias de container"
        />

        <FilterCard hasFilters={!!searchTerm} onClear={() => setSearchTerm('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Container ou cliente" className="sm:col-span-2">
              <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-vistoria" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma vistoria pra habilitar as ações da barra */}
        <DataCard
          title="Vistorias"
          count={pagination.total.toLocaleString('pt-BR')}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova vistoria" onClick={() => navigate('/container-vistorias/new')} testId="new-vistoria-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedItem && navigate(`/container-vistorias/${singleSelectedItem.id}`)} disabled={!singleSelectedItem} testId="view-vistoria-button" />
              <ToolbarButton icon={Printer} label="Imprimir" tone="emerald" onClick={() => singleSelectedItem && navigate(`/container-vistorias/${singleSelectedItem.id}?print=true`)} disabled={!singleSelectedItem} testId="print-vistoria-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)} disabled={!singleSelectedItem} testId="delete-vistoria-button" />
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
          ) : filteredVistorias.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nenhuma vistoria encontrada" hint="Ajuste a busca ou crie uma nova vistoria" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredVistorias.length > 0 && filteredVistorias.every(v => selectedIds.has(v.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Container</th>
                    <th>Cliente</th>
                    <th className="hidden sm:table-cell">Estado</th>
                    <th className="hidden sm:table-cell">Fotos</th>
                    <th className="hidden sm:table-cell">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVistorias.map((vistoria) => (
                    <tr
                      key={vistoria.id}
                      onClick={() => toggleSelect(vistoria.id)}
                      data-selected={selectedIds.has(vistoria.id)}
                      className="cursor-pointer"
                      data-testid={`vistoria-row-${vistoria.id}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(vistoria.id)}
                          onCheckedChange={() => toggleSelect(vistoria.id)}
                          data-testid="vistoria-row-checkbox"
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{vistoria.vistoria_number}</td>
                      <td className="font-mono whitespace-nowrap text-slate-700 dark:text-slate-200">{vistoria.container_number}</td>
                      <td><div className="max-w-[260px] truncate" title={vistoria.client_name || ''}>{vistoria.client_name || '-'}</div></td>
                      <td className="hidden sm:table-cell">
                        {vistoria.no_damage ? (
                          <StatusPill tone="emerald">Sem avarias</StatusPill>
                        ) : (vistoria.damage_items || []).length > 0 ? (
                          <StatusPill tone="red">{vistoria.damage_items.length} serviço{vistoria.damage_items.length > 1 ? 's' : ''}</StatusPill>
                        ) : (
                          <StatusPill tone="slate" dot={false}>-</StatusPill>
                        )}
                      </td>
                      <td className="hidden sm:table-cell">
                        <StatusPill tone={getPhotoCount(vistoria) > 0 ? 'emerald' : 'slate'}>{getPhotoCount(vistoria)}/12</StatusPill>
                      </td>
                      <td className="hidden sm:table-cell whitespace-nowrap tabular-nums">
                        {format(new Date(vistoria.created_at), 'dd/MM/yyyy', { locale: ptBR })}{' '}
                        <span className="text-slate-400 dark:text-slate-500">{format(new Date(vistoria.created_at), 'HH:mm', { locale: ptBR })}</span>
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
