import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, EmptyState, StatusPill, TablePagination, usePagination,
} from '../components/DataPage';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { qtyWithUnit } from '../lib/productUnits';
import { toast } from 'sonner';
import { Boxes, PackageCheck, Wallet, AlertTriangle } from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Consulta de saldo (só leitura). O cadastro fica em Almoxarifado > Produto e
// o saldo muda por Movimentação, NF-e, Entrega de EPI ou "Ajustar saldo".
const BALANCE_OPTIONS = [
  ['all', 'Todos'],
  ['in', 'Com saldo'],
  ['out', 'Sem saldo'],
];

export default function StockPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [balance, setBalance] = useState('all');

  useEffect(() => { loadItems(); }, []);

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await api.getProducts();
      setItems(response.data);
    } catch (error) {
      toast.error('Erro ao carregar estoque');
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter((item) => {
    const qty = Number(item.stock_quantity) || 0;
    if (balance === 'in' && qty <= 0) return false;
    if (balance === 'out' && qty > 0) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return item.description?.toLowerCase().includes(term) || item.warehouse_name?.toLowerCase().includes(term) || String(item.code).includes(term);
  });

  const { pageItems, paginationProps } = usePagination(filteredItems, { resetKey: `${search}|${balance}` });

  const totalValue = filteredItems.reduce((acc, i) => acc + (Number(i.stock_quantity) || 0) * (Number(i.reference_value) || 0), 0);
  const outOfStock = filteredItems.filter((i) => (Number(i.stock_quantity) || 0) <= 0).length;
  const hasFilters = !!search || balance !== 'all';

  return (
    <Layout>
      <div className="space-y-4" data-testid="stock-page">
        <PageHeader icon={Boxes} title="Estoque" subtitle="Consulta de saldo de produtos em estoque" />

        <StatGrid>
          <StatCard label="Produtos" value={filteredItems.length} icon={Boxes} tone="blue" hint={hasFilters ? 'dentro do filtro' : 'cadastrados'} />
          {/* Quantos têm saldo (somar as quantidades misturaria kg, litro e unidade) */}
          <StatCard label="Com saldo" value={filteredItems.length - outOfStock} icon={PackageCheck} tone="primary" hint="produtos com quantidade em estoque" testId="stock-kpi-in-stock" />
          <StatCard label="Valor em estoque" value={fmtMoney(totalValue)} icon={Wallet} tone="emerald" hint="quantidade x valor de referência" />
          <StatCard label="Sem estoque" value={outOfStock} icon={AlertTriangle} tone={outOfStock > 0 ? 'amber' : 'slate'} hint="saldo zerado ou negativo" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setBalance('all'); }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Código, produto ou almoxarifado">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-stock-input" />
            </FilterField>
            <FilterField label="Saldo">
              <Select value={balance} onValueChange={setBalance}>
                <SelectTrigger className="h-9 text-sm" data-testid="stock-balance-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BALANCE_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value} className="text-[13px]">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Produtos em estoque"
          count={loading ? '...' : filteredItems.length}
          footer={<TablePagination {...paginationProps} />}
        >
          {loading ? (
            <EmptyState title="Carregando..." />
          ) : filteredItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cód. produto</th>
                    <th>Produto</th>
                    <th>Almoxarifado</th>
                    <th className="!text-right">Saldo</th>
                    <th className="!text-right">Valor unit.</th>
                    <th className="!text-right">Valor em estoque</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => {
                    const qty = Number(item.stock_quantity ?? 0);
                    return (
                      <tr key={item.id} data-testid="stock-row">
                        <td className="cell-strong whitespace-nowrap tabular-nums">{item.code}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="max-w-[360px] truncate" title={item.description || ''}>{item.description}</span>
                            {item.status === 'INATIVO' && <StatusPill tone="slate" dot={false} className="text-[10px] px-1.5">Inativo</StatusPill>}
                          </div>
                        </td>
                        <td><div className="max-w-[200px] truncate" title={item.warehouse_name || ''}>{item.warehouse_name || '-'}</div></td>
                        <td className={`text-right whitespace-nowrap tabular-nums font-medium ${qty <= 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{qtyWithUnit(qty, item.unit)}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">{fmtMoney(item.reference_value)}</td>
                        <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(qty * (Number(item.reference_value) || 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Boxes}
              title={hasFilters ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}
              hint={hasFilters ? 'Ajuste a busca ou o filtro de saldo' : 'Os produtos são cadastrados em Almoxarifado > Produto ou pela importação de NF-e'}
            />
          )}
        </DataCard>
      </div>
    </Layout>
  );
}
