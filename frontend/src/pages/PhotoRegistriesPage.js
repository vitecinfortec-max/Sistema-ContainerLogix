import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Search, Eye, Trash2, Camera, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function PhotoRegistriesPage() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [registries, setRegistries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

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

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir este registro fotográfico? Esta ação não pode ser desfeita.'))) return;
    try {
      await api.deletePhotoRegistry(id);
      toast.success('Registro excluído com sucesso');
      loadRegistries();
    } catch (error) {
      toast.error('Erro ao excluir registro');
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
      <div className="space-y-5" data-testid="photo-registries-page">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Registro Fotográfico
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gerenciamento de fotos de contêineres</p>
          </div>
          <Button
            onClick={() => navigate('/photo-registries/new')}
            data-testid="new-registry-btn"
            className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Novo Registro
          </Button>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
              <Search className="w-4 h-4" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <form onSubmit={handleSearch} className="space-y-3">
              <div className="grid grid-cols-1 sm:max-w-sm gap-3">
                <div>
                  <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Container, booking ou cliente</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                    <Input
                      placeholder="Buscar..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-9 text-sm pl-8"
                      data-testid="search-input"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" size="sm" className="h-8 text-xs font-medium bg-primary hover:bg-primary/90" data-testid="search-btn">
                  Filtrar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Camera className="w-4 h-4" />
              Registros Fotográficos
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 text-center text-muted-foreground">Carregando...</div>
            ) : registries.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Nenhum registro fotográfico encontrado
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Container</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Booking</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Armador</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Fotos</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Criado em</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Criado por</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registries.map((registry, idx) => (
                        <tr
                          key={registry.id}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors cursor-pointer ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}
                          onClick={() => navigate(`/photo-registries/${registry.id}`)}
                          data-testid={`registry-row-${registry.id}`}
                        >
                          <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{registry.registry_number}</td>
                          <td className="px-4 py-2.5 text-sm font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">{registry.container_number}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{registry.booking || '-'}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{registry.client_name || '-'}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{registry.shipping_line_name || '-'}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                              countPhotos(registry) === 4
                                ? 'bg-emerald-50 text-emerald-700'
                                : countPhotos(registry) > 0
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                            }`}>
                              <Camera className="w-3 h-3" />
                              {countPhotos(registry)}/4
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                            {format(new Date(registry.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                            {registry.created_by_name?.split(' ').slice(0, 2).join(' ') || '-'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/photo-registries/${registry.id}`)}
                                title="Visualizar"
                                className="h-7 w-7 p-0"
                                data-testid={`view-btn-${registry.id}`}
                              >
                                <Eye className="w-3.5 h-3.5 text-primary" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/photo-registries/${registry.id}?print=true`)}
                                title="Imprimir"
                                className="h-7 w-7 p-0"
                                data-testid={`print-btn-${registry.id}`}
                              >
                                <Printer className="w-3.5 h-3.5 text-green-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(registry.id)}
                                title="Excluir"
                                className="h-7 w-7 p-0"
                                data-testid={`delete-btn-${registry.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
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
      <ConfirmDialog />
    </Layout>
  );
}
