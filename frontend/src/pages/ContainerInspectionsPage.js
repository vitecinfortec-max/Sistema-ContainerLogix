import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Eye, Printer, Trash2, Search, ClipboardCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ContainerInspectionsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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
      toast.error('Erro ao carregar vistorias');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!(await confirm('Tem certeza que deseja excluir esta vistoria?'))) return;
    
    try {
      await api.deleteContainerInspection(id);
      toast.success('Vistoria excluída com sucesso!');
      loadInspections();
    } catch (error) {
      toast.error('Erro ao excluir vistoria');
    }
  };

  const getPhotoCount = (inspection) => (inspection.photos || []).length;

  const filteredInspections = inspections.filter(i => 
    i.container_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.booking?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    i.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <div className="space-y-6" data-testid="container-inspections-page">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Vistoria de Container
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gerenciamento de vistorias de containers</p>
          </div>
          <Button onClick={() => navigate('/container-inspections/new')} data-testid="new-inspection-btn">
            <Plus className="w-4 h-4 mr-2" />
            Nova Vistoria
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5" />
                Lista de Vistorias ({pagination.total})
              </CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Carregando...</div>
            ) : filteredInspections.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma vistoria de container encontrada
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium">Nº</th>
                      <th className="text-left py-3 px-4 font-medium">Container</th>
                      <th className="text-left py-3 px-4 font-medium">Cliente</th>
                      <th className="text-left py-3 px-4 font-medium">Fotos</th>
                      <th className="text-left py-3 px-4 font-medium">Criado em</th>
                      <th className="text-left py-3 px-4 font-medium">Criado por</th>
                      <th className="text-left py-3 px-4 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInspections.map(inspection => (
                      <tr 
                        key={inspection.id} 
                        className="border-b hover:bg-muted/50 cursor-pointer"
                        onClick={() => navigate(`/container-inspections/${inspection.id}`)}
                        data-testid={`inspection-row-${inspection.id}`}
                      >
                        <td className="py-3 px-4 font-medium">#{inspection.inspection_number}</td>
                        <td className="py-3 px-4 text-sm whitespace-nowrap">{inspection.container_number}</td>
                        <td className="py-3 px-4">{inspection.client_name || '-'}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            getPhotoCount(inspection) > 0 ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200'
                          }`}>
                            {getPhotoCount(inspection)}/8
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm">
                          {format(new Date(inspection.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </td>
                        <td className="py-3 px-4">
                          {inspection.created_by_name?.split(' ').slice(0, 2).join(' ') || '-'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); navigate(`/container-inspections/${inspection.id}`); }}
                              title="Visualizar"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); navigate(`/container-inspections/${inspection.id}?print=true`); }}
                              title="Imprimir"
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={(e) => handleDelete(inspection.id, e)}
                              title="Excluir"
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginação */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Página {pagination.page} de {pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page === 1}
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page === pagination.totalPages}
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                  >
                    Próximo
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
