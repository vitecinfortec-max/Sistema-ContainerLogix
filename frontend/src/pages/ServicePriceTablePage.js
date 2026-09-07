import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Edit, ListTree } from 'lucide-react';

export default function ServicePriceTablePage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [clientNameInput, setClientNameInput] = useState('');

  const [allEntries, setAllEntries] = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    loadClients();
    loadSummary();
  }, []);

  const loadClients = async () => {
    try {
      const response = await api.getClients();
      setClients(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      toast.error('Erro ao carregar clientes');
    }
  };

  // Todas as entradas de todos os clientes, só pra montar a lista "Clientes
  // com Tabela Cadastrada" abaixo - dá visibilidade de quem já tem preço
  // configurado sem precisar buscar cliente por cliente.
  const loadSummary = async () => {
    setLoadingSummary(true);
    try {
      const response = await api.getServicePriceEntries();
      setAllEntries(response.data);
    } catch (error) {
      toast.error('Erro ao carregar resumo das tabelas cadastradas');
    } finally {
      setLoadingSummary(false);
    }
  };

  const clientSummaries = Object.values(
    allEntries.reduce((acc, e) => {
      if (!acc[e.client_id]) acc[e.client_id] = { client_id: e.client_id, client_name: e.client_name, count: 0 };
      acc[e.client_id].count += 1;
      return acc;
    }, {})
  ).sort((a, b) => a.client_name.localeCompare(b.client_name));

  const goToClient = (clientId) => navigate(`/comercial/tabela-servicos/${clientId}`);

  return (
    <Layout>
      <div className="space-y-5" data-testid="service-price-table-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Tabela de Serviços</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Preços por cliente - usados para preencher automaticamente o Valor do Serviço na emissão de EIR</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none max-w-lg">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Cliente</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <Label>Selecione o cliente</Label>
            <Autocomplete
              value={clientNameInput}
              onChange={setClientNameInput}
              options={clients}
              displayField="name"
              onSelect={(c) => goToClient(c.id)}
              className="w-full"
            />
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <ListTree className="w-4 h-4" />
              Clientes com Tabela Cadastrada ({clientSummaries.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingSummary ? (
              <div className="text-center py-6 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : clientSummaries.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-500 dark:text-slate-400">Nenhum cliente com tabela de serviços cadastrada ainda</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Serviços Cadastrados</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientSummaries.map((cs, idx) => (
                      <tr
                        key={cs.client_id}
                        onClick={() => goToClient(cs.client_id)}
                        className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}
                        data-testid={`service-price-summary-row-${cs.client_id}`}
                      >
                        <td className="px-4 py-2.5 text-sm text-slate-800 dark:text-slate-200">{cs.client_name}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{cs.count}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Editar">
                            <Edit className="w-3.5 h-3.5 text-blue-600" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
