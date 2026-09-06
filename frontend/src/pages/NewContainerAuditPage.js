import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, ListChecks } from 'lucide-react';

export default function NewContainerAuditPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const response = await api.getClients();
      setClients(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      toast.error('Erro ao carregar clientes');
    }
  };

  const filteredClients = clients.filter(c =>
    c.name?.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const handleClientSelect = (client) => {
    setSelectedClient(client);
    setClientSearch(client.name);
    setShowClientDropdown(false);
  };

  const handleStart = async () => {
    if (!selectedClient) {
      toast.error('Selecione o cliente que será auditado');
      return;
    }
    setCreating(true);
    try {
      const response = await api.createContainerAudit({ client_id: selectedClient.id });
      toast.success(`Auditoria ${response.data.audit_code} iniciada`);
      navigate(`/container-audits/${response.data.id}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao iniciar auditoria');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="new-container-audit-page">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate('/container-audits')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Nova Auditoria</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Escolha o cliente que será auditado</p>
          </div>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none max-w-lg">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <ListChecks className="w-4 h-4" />
              Cliente a Auditar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="relative">
              <Label htmlFor="client">Cliente</Label>
              <Input
                id="client"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setShowClientDropdown(true);
                  if (!e.target.value) setSelectedClient(null);
                }}
                onFocus={() => setShowClientDropdown(true)}
                onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                data-testid="audit-client-input"
              />
              {showClientDropdown && filteredClients.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-900 border rounded-md shadow-lg max-h-48 overflow-auto">
                  {filteredClients.map(client => (
                    <div
                      key={client.id}
                      className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer text-sm"
                      onMouseDown={() => handleClientSelect(client)}
                    >
                      {client.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              O sistema vai trazer automaticamente todos os containers que constam em estoque para este cliente, pra você confrontar com o que encontrar no pátio.
            </p>

            <Button onClick={handleStart} disabled={!selectedClient || creating} className="w-full" data-testid="start-audit-btn">
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Iniciar Auditoria
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
