import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Search, Boxes } from 'lucide-react';

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

  return (
    <Layout>
      <div className="space-y-5" data-testid="stock-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Estoque</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Consulta de saldo de produtos em estoque</p>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <Input placeholder="Buscar por produto, almoxarifado ou código..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 text-[13px] pl-9" data-testid="search-stock-input" />
        </div>

        <Card>
          <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-[13px] font-medium">
              {loading ? 'Carregando...' : `Produtos em Estoque (${filteredItems.length})`}
            </CardTitle>
            {!loading && <span className="text-[13px] font-semibold text-primary">Valor Total: {fmtMoney(totalValue)}</span>}
          </CardHeader>
          <CardContent className="p-0">
            {filteredItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cód. Produto</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Almoxarifado</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Produto</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Quantidade</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Valor do Produto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="stock-row">
                        <td className="px-4 py-2.5 text-[13px] font-semibold text-primary">{item.code}</td>
                        <td className="px-4 py-2.5 text-[13px]">{item.warehouse_name || '-'}</td>
                        <td className="px-4 py-2.5 text-[13px]">{item.description}</td>
                        <td className="px-4 py-2.5 text-[13px]">{item.stock_quantity ?? 0}</td>
                        <td className="px-4 py-2.5 text-[13px]">{fmtMoney(item.reference_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400">
                <Boxes className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-[13px] font-medium">{search ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
