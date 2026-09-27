import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { FilterField, DataCard, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
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
      <div className="space-y-4" data-testid="service-price-table-page">
        <PageHeader
          icon={ListTree}
          title="Tabela de Serviços"
          subtitle="Preços por cliente - usados para preencher automaticamente o Valor do Serviço na emissão de EIR"
        />

        <DataCard title="Abrir tabela de um cliente" className="max-w-xl">
          <div className="p-4">
            <FilterField label="Cliente">
              <Autocomplete
                value={clientNameInput}
                onChange={setClientNameInput}
                options={clients}
                displayField="name"
                onSelect={(c) => goToClient(c.id)}
                className="w-full text-sm"
              />
            </FilterField>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">Digite o nome e escolha o cliente para ver ou editar os preços dele.</p>
          </div>
        </DataCard>

        <DataCard title="Clientes com tabela cadastrada" count={loadingSummary ? '...' : clientSummaries.length}>
          {loadingSummary ? (
            <EmptyState title="Carregando..." />
          ) : clientSummaries.length === 0 ? (
            <EmptyState icon={ListTree} title="Nenhum cliente com tabela de serviços cadastrada ainda" hint="Escolha um cliente acima para cadastrar os preços dele" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="!text-right">Serviços cadastrados</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {clientSummaries.map((cs) => (
                    <tr
                      key={cs.client_id}
                      onClick={() => goToClient(cs.client_id)}
                      className="cursor-pointer"
                      data-testid={`service-price-summary-row-${cs.client_id}`}
                    >
                      <td className="cell-strong"><div className="max-w-[420px] truncate" title={cs.client_name}>{cs.client_name}</div></td>
                      <td className="text-right tabular-nums">{cs.count}</td>
                      <td className="text-right !py-1">
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
        </DataCard>
      </div>
    </Layout>
  );
}
