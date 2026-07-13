import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Plus, Search, Eye, Trash2, Camera, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";

export default function PhotoRegistriesPage() {
  const navigate = useNavigate();
  const [registries, setRegistries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    loadRegistries();
  }, [page, search]);

  const loadRegistries = async () => {
    try {
      setLoading(true);
      const response = await api.getPhotoRegistries({ 
        page, 
        page_size: 20,
        search: search || undefined 
      });
      setRegistries(response.data.items);
      setTotalPages(response.data.pages);
    } catch (error) {
      toast.error('Erro ao carregar registros fotográficos');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadRegistries();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.deletePhotoRegistry(deleteId);
      toast.success('Registro excluído com sucesso');
      loadRegistries();
    } catch (error) {
      toast.error('Erro ao excluir registro');
    } finally {
      setDeleteId(null);
    }
  };

  const countPhotos = (registry) => {
    let count = 0;
    if (registry.photo_front) count++;
    if (registry.photo_back) count++;
    if (registry.photo_left) count++;
    if (registry.photo_right) count++;
    return count;
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto" data-testid="photo-registries-page">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
              Registro Fotográfico
            </h1>
            <p className="text-muted-foreground mt-1">Gerenciamento de fotos de contêineres</p>
          </div>
          <Button onClick={() => navigate('/photo-registries/new')} data-testid="new-registry-btn">
            <Plus className="w-4 h-4 mr-2" />
            Novo Registro
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleSearch} className="flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Buscar por container, booking ou cliente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                  data-testid="search-input"
                />
              </div>
              <Button type="submit" variant="secondary" data-testid="search-btn">
                Buscar
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Registros Fotográficos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Carregando...</div>
            ) : registries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum registro fotográfico encontrado
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-semibold">Nº</th>
                        <th className="text-left py-3 px-4 font-semibold">Container</th>
                        <th className="text-left py-3 px-4 font-semibold">Booking</th>
                        <th className="text-left py-3 px-4 font-semibold">Cliente</th>
                        <th className="text-left py-3 px-4 font-semibold">Armador</th>
                        <th className="text-left py-3 px-4 font-semibold">Fotos</th>
                        <th className="text-left py-3 px-4 font-semibold">Criado em</th>
                        <th className="text-left py-3 px-4 font-semibold">Criado por</th>
                        <th className="text-right py-3 px-4 font-semibold">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registries.map((registry) => (
                        <tr 
                          key={registry.id} 
                          className="border-b hover:bg-muted/50 cursor-pointer"
                          onClick={() => navigate(`/photo-registries/${registry.id}`)}
                          data-testid={`registry-row-${registry.id}`}
                        >
                          <td className="py-3 px-4 font-medium">#{registry.registry_number}</td>
                          <td className="py-3 px-4 text-sm whitespace-nowrap">{registry.container_number}</td>
                          <td className="py-3 px-4">{registry.booking || '-'}</td>
                          <td className="py-3 px-4">{registry.client_name || '-'}</td>
                          <td className="py-3 px-4">{registry.shipping_line_name || '-'}</td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                              countPhotos(registry) === 4 
                                ? 'bg-green-100 text-green-700' 
                                : countPhotos(registry) > 0 
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-gray-100 text-gray-700'
                            }`}>
                              <Camera className="w-3 h-3" />
                              {countPhotos(registry)}/4
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {format(new Date(registry.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </td>
                          <td className="py-3 px-4">
                            {registry.created_by_name?.split(' ').slice(0, 2).join(' ') || '-'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigate(`/photo-registries/${registry.id}`)}
                                data-testid={`view-btn-${registry.id}`}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigate(`/photo-registries/${registry.id}?print=true`)}
                                data-testid={`print-btn-${registry.id}`}
                              >
                                <Printer className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteId(registry.id)}
                                className="text-red-500 hover:text-red-700"
                                data-testid={`delete-btn-${registry.id}`}
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

                {/* Paginação */}
                {totalPages > 1 && (
                  <div className="flex justify-center gap-2 mt-6">
                    <Button
                      variant="outline"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Anterior
                    </Button>
                    <span className="flex items-center px-4">
                      Página {page} de {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Próxima
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este registro fotográfico? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
