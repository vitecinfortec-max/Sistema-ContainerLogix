import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState, TablePagination, usePagination,
  rowTone,
} from '../components/DataPage';
import { Checkbox } from '../components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, FileText, Printer, Clock, Wrench, Wallet } from 'lucide-react';

import { useUrlState } from '../hooks/useUrlState';
import { apiErrorMessage } from '../lib/errors';
const STATUS_TONES = {
  ABERTO: 'blue',
  ANDAMENTO: 'amber',
  FECHADO: 'emerald',
  CANCELADO: 'red',
};
const STATUS_LABELS = { ABERTO: 'Aberto', ANDAMENTO: 'Em Andamento', FECHADO: 'Fechado', CANCELADO: 'Cancelado' };

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function OrdemServicoPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useUrlState('search', '');
  const { pageItems, paginationProps } = usePagination(list, { resetKey: search });
  const [statusFilter, setStatusFilter] = useUrlState('status', 'all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const debounceRef = useRef(null);

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadList(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search, statusFilter]);

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (statusFilter !== 'all') params.status = statusFilter;
      const r = await api.getOrdensServico(params);
      setList(r.data || []);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao carregar Ordens de Serviço'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, num) => {
    if (!(await confirm(`Excluir OS Nº ${num}?`))) return;
    try {
      await api.deleteOrdemServico(id);
      toast.success('OS excluída');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadList();
    } catch (e) { toast.error(apiErrorMessage(e, 'Erro ao excluir')); }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = pageItems.map((o) => o.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const downloadPDF = async (id, num) => {
    try {
      const r = await api.getOrdemServicoPDF(id);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `OS_${num}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF gerado!');
    } catch (e) { toast.error(apiErrorMessage(e, 'Erro ao gerar PDF')); }
  };

  const singleSelectedOS = selectedIds.size === 1 ? list.find((o) => o.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="ordem-servico-page">
        <PageHeader icon={FileText} title="Ordem de Serviço" subtitle="Gestão de OS para manutenção da frota" />

        <StatGrid>
          <StatCard label="Ordens de serviço" value={list.length} icon={FileText} tone="primary" hint={search || statusFilter !== 'all' ? 'com os filtros atuais' : 'cadastradas'} />
          <StatCard label="Abertas" value={list.filter((o) => o.status === 'ABERTO').length} icon={Clock} tone="blue" />
          <StatCard label="Em andamento" value={list.filter((o) => o.status === 'ANDAMENTO').length} icon={Wrench} tone="amber" />
          <StatCard label="Valor total" value={fmtMoney(list.reduce((acc, o) => acc + (o.status === 'CANCELADO' ? 0 : Number(o.grand_total || 0)), 0))} icon={Wallet} tone="emerald" hint="sem as canceladas" />
        </StatGrid>

        <FilterCard
          hasFilters={!!search || statusFilter !== 'all'}
          onClear={() => { setSearch(''); setStatusFilter('all'); }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Pessoa, placa, descrição ou categoria" className="sm:col-span-1 lg:col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="os-search" />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-sm" data-testid="os-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="ABERTO">Aberto</SelectItem>
                  <SelectItem value="ANDAMENTO">Em Andamento</SelectItem>
                  <SelectItem value="FECHADO">Fechado</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma OS pra habilitar as ações da barra */}
        <DataCard
          title="Ordens de serviço"
          count={loading ? '...' : list.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova OS" onClick={() => navigate('/fleet/ordem-servico/new')} testId="os-new-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedOS && navigate(`/fleet/ordem-servico/${singleSelectedOS.id}/edit`)} disabled={!singleSelectedOS} />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedOS && downloadPDF(singleSelectedOS.id, singleSelectedOS.os_number)} disabled={!singleSelectedOS} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedOS && handleDelete(singleSelectedOS.id, singleSelectedOS.os_number)} disabled={!singleSelectedOS} />
            </Toolbar>
          )}
          footer={<TablePagination {...paginationProps} />}
        >
          {list.length === 0 && !loading ? (
            <EmptyState
              icon={FileText}
              title={search || statusFilter !== 'all' ? 'Nenhuma OS encontrada' : 'Nenhuma OS cadastrada'}
              hint={search || statusFilter !== 'all' ? 'Ajuste os filtros' : 'Cadastre a primeira pelo botão "Nova OS"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={pageItems.length > 0 && pageItems.every((o) => selectedIds.has(o.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Abertura</th>
                    <th>Pessoa</th>
                    <th>Placa</th>
                    <th>Categoria</th>
                    <th>Status</th>
                    <th className="!text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => toggleSelect(o.id)}
                      data-selected={selectedIds.has(o.id)}
                      data-row-tone={rowTone(o.status === 'CANCELADO' ? 'off' : null)}
                      className="cursor-pointer"
                      data-testid={`os-row-${o.os_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={() => toggleSelect(o.id)}
                          data-testid={`os-row-checkbox-${o.os_number}`}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{o.os_number}</td>
                      <td className="whitespace-nowrap tabular-nums">{o.opened_at ? format(new Date(o.opened_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                      <td><div className="max-w-[13.75rem] truncate" title={o.person_name || ''}>{o.person_name || '-'}</div></td>
                      <td><PlateTag>{o.equipment_plate}</PlateTag></td>
                      <td><div className="max-w-[12.5rem] truncate" title={o.category || ''}>{o.category || '-'}</div></td>
                      <td>
                        <StatusPill tone={STATUS_TONES[o.status] || 'slate'}>
                          {STATUS_LABELS[o.status] || o.status}
                        </StatusPill>
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(o.grand_total)}</td>
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
