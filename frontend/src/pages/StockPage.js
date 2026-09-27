import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, EmptyState } from '../components/DataPage';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Boxes, Package, Wallet, AlertTriangle } from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function StockPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return item.description?.toLowerCase().includes(term) || item.warehouse_name?.toLowerCase().includes(term) || String(item.code).includes(term);
  });

  const totalValue = filteredItems.reduce((acc, i) => acc + (Number(i.stock_quantity) || 0) * (Number(i.reference_value) || 0), 0);
  const totalUnits = filteredItems.reduce((acc, i) => acc + (Number(i.stock_quantity) || 0), 0);
  const outOfStock = filteredItems.filter((i) => (Number(i.stock_quantity) || 0) <= 0).length;

  return (
    <Layout>
      <div className="space-y-4" data-testid="stock-page">
        <PageHeader icon={Boxes} title="Estoque" subtitle="Consulta de saldo de produtos em estoque" />

        <StatGrid>
          <StatCard label="Produtos" value={filteredItems.length} icon={Boxes} tone="blue" hint={search ? 'que batem com a busca' : 'cadastrados'} />
          <StatCard label="Unidades em estoque" value={totalUnits.toLocaleString('pt-BR')} icon={Package} tone="primary" />
          <StatCard label="Valor em estoque" value={fmtMoney(totalValue)} icon={Wallet} tone="emerald" hint="quantidade x valor de referência" />
          <StatCard label="Sem estoque" value={outOfStock} icon={AlertTriangle} tone={outOfStock > 0 ? 'amber' : 'slate'} hint="saldo zerado ou negativo" />
        </StatGrid>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Código, produto ou almoxarifado">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-stock-input" />
            </FilterField>
          </div>
        </FilterCard>

        <DataCard title="Produtos em estoque" count={loading ? '...' : filteredItems.length}>
          {loading ? (
            <EmptyState title="Carregando..." />
          ) : filteredItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cód. produto</th>
                    <th>Almoxarifado</th>
                    <th>Produto</th>
                    <th className="!text-right">Quantidade</th>
                    <th className="!text-right">Valor do produto</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const qty = Number(item.stock_quantity ?? 0);
                    return (
                      <tr key={item.id} data-testid="stock-row">
                        <td className="cell-strong whitespace-nowrap tabular-nums">{item.code}</td>
                        <td><div className="max-w-[200px] truncate" title={item.warehouse_name || ''}>{item.warehouse_name || '-'}</div></td>
                        <td><div className="max-w-[360px] truncate" title={item.description || ''}>{item.description}</div></td>
                        <td className={`text-right tabular-nums font-medium ${qty <= 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{item.stock_quantity ?? 0}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">{fmtMoney(item.reference_value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Boxes}
              title={search ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}
              hint={search ? 'Ajuste a busca' : 'Os produtos são cadastrados em Estoque > Produto ou pela importação de NF-e'}
            />
          )}
        </DataCard>
      </div>
    </Layout>
  );
}
