import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { toDateInput, toLocalDay } from '../lib/dates';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, FileText, Printer, Banknote, HandCoins, Wallet } from 'lucide-react';
import { useUrlState } from '../hooks/useUrlState';
import { apiErrorMessage } from '../lib/errors';
import { fmtMoney, downloadFreightContractPdf } from '../lib/freightContracts';

export default function RPATerceiroPage({ rpaType = 'terceiro' }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();

  const [rpas, setRpas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useUrlState('search', '');
  const [dateFrom, setDateFrom] = useUrlState('dateFrom', '');
  const [dateTo, setDateTo] = useUrlState('dateTo', '');
  // Período pela data do contrato (coluna "Data"); sem ela, pelo dia do cadastro
  const contractDay = (r) => (r.service_date ? toDateInput(r.service_date) : (r.created_at ? toLocalDay(new Date(r.created_at)) : ''));
  const filteredRpas = rpas.filter((r) => {
    if (!dateFrom && !dateTo) return true;
    const day = contractDay(r);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    return true;
  });
  const { pageItems, paginationProps } = usePagination(filteredRpas, { resetKey: `${search}|${dateFrom}|${dateTo}` });
  const sumOf = (field) => filteredRpas.reduce((acc, r) => acc + Number(r[field] || 0), 0);
  const hasFilters = !!(search || dateFrom || dateTo);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const debounceRef = useRef(null);

  useEffect(() => { loadRpas(); }, [rpaType]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadRpas(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search]);

  const loadRpas = async () => {
    setLoading(true);
    try {
      const params = { rpa_type: rpaType };
      if (search) params.search = search;
      const r = await api.getRPATerceiros(params);
      setRpas(r.data || []);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao carregar contratos'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, num) => {
    if (!(await confirm(`Excluir Contrato Nº ${num}?`))) return;
    try {
      await api.deleteRPATerceiro(id);
      toast.success('Contrato excluído');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadRpas();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao excluir'));
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = pageItems.map((r) => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const singleSelectedContract = selectedIds.size === 1 ? rpas.find((r) => r.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="rpa-terceiro-page">
        <PageHeader icon={FileText} title="Contrato de Frete" subtitle="Contrato de Afretamento para motoristas terceiros" />

        <StatGrid>
          <StatCard label="Contratos" value={filteredRpas.length} icon={FileText} tone="blue" hint={hasFilters ? 'com os filtros atuais' : 'cadastrados'} />
          <StatCard label="Valor dos serviços" value={fmtMoney(sumOf('service_value'))} icon={Banknote} tone="primary" />
          <StatCard label="Adiantamentos" value={fmtMoney(sumOf('advance'))} icon={HandCoins} tone="amber" />
          <StatCard label="Saldo a receber" value={fmtMoney(sumOf('balance'))} icon={Wallet} tone="emerald" hint="dos contratados" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Motorista, cliente, container ou placa" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="rpa-search-input" />
            </FilterField>
            <FilterField label="Data inicial">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="rpa-date-from" />
            </FilterField>
            <FilterField label="Data final">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="rpa-date-to" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um contrato pra habilitar as ações da barra */}
        <DataCard
          title="Contratos"
          count={loading ? '...' : filteredRpas.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo contrato" onClick={() => navigate('/fleet/rpa-terceiro/new')} testId="rpa-new-button" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedContract && navigate(`/fleet/rpa-terceiro/${singleSelectedContract.id}/edit`)} disabled={!singleSelectedContract} />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedContract && downloadFreightContractPdf(singleSelectedContract.id, singleSelectedContract.rpa_number)} disabled={!singleSelectedContract} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedContract && handleDelete(singleSelectedContract.id, singleSelectedContract.rpa_number)} disabled={!singleSelectedContract} />
            </Toolbar>
          )}
          footer={<TablePagination {...paginationProps} />}
        >
          {filteredRpas.length === 0 && !loading ? (
            <EmptyState
              icon={FileText}
              title={hasFilters ? 'Nenhum contrato encontrado' : 'Nenhum contrato cadastrado'}
              hint={hasFilters ? 'Ajuste os filtros' : 'Cadastre o primeiro pelo botão "Novo contrato"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={pageItems.length > 0 && pageItems.every((r) => selectedIds.has(r.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Motorista</th>
                    <th>CPF</th>
                    <th>Cliente</th>
                    <th>Container</th>
                    <th>Data</th>
                    <th className="!text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => toggleSelect(r.id)}
                      onDoubleClick={() => navigate(`/fleet/rpa-terceiro/${r.id}/edit`)}
                      data-selected={selectedIds.has(r.id)}
                      className="cursor-pointer"
                      data-testid={`rpa-row-${r.rpa_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onCheckedChange={() => toggleSelect(r.id)}
                          data-testid={`rpa-row-checkbox-${r.rpa_number}`}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{r.rpa_number}</td>
                      <td><div className="max-w-[13.75rem] truncate" title={r.driver_name || ''}>{r.driver_name || '-'}</div></td>
                      <td className="whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400">{r.driver_cpf || '-'}</td>
                      <td><div className="max-w-[13.75rem] truncate" title={r.client_name || ''}>{r.client_name || '-'}</div></td>
                      <td className="font-mono whitespace-nowrap text-slate-700 dark:text-slate-200">{r.container_number || '-'}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {toDateInput(r.service_date) ? format(new Date(`${toDateInput(r.service_date)}T00:00:00`), 'dd/MM/yyyy') : '-'}
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(r.balance)}</td>
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

