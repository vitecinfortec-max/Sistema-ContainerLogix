import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Eye, Printer, Trash2, Search, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ContainerVistoriasPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [vistorias, setVistorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pagination, setPagination] = useState({
    page: 1,
    perPage: 20,
    total: 0,
    totalPages: 0
  });

  useEffect(() => {
    loadVistorias();
  }, [pagination.page]);

  const loadVistorias = async () => {
    try {
      const response = await api.getContainerVistorias({
        page: pagination.page,
        per_page: pagination.perPage
      });
      setVistorias(response.data.items);
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

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir esta vistoria?'))) return;

    try {
      await api.deleteContainerVistoria(id);
      toast.success('Vistoria excluída com sucesso!');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadVistorias();
    } catch (error) {
      toast.error('Erro ao excluir vistoria');
    }
  };

  const getPhotoCount = (vistoria) => (vistoria.photos || []).length;

  const filteredVistorias = vistorias.filter(v =>
    v.container_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredVistorias.map(v => v.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const singleSelectedItem = selectedIds.size === 1 ? filteredVistorias.find(v => v.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-5" data-testid="container-vistorias-page">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Vistoria de Container</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gerenciamento de vistorias de container</p>
        </div>

        {/* Filtros */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
              <div className="sm:col-span-2">
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Container ou Cliente</Label>
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 text-xs"
                  data-testid="search-vistoria"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Barra de ações - marque uma vistoria na tabela abaixo pra habilitar as ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/container-vistorias/new')}
            title="Adicionar"
            data-testid="new-vistoria-btn"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && navigate(`/container-vistorias/${singleSelectedItem.id}`)}
            disabled={!singleSelectedItem}
            title="Ver Detalhes"
            data-testid="view-vistoria-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Eye className="w-4 h-4 text-primary" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && navigate(`/container-vistorias/${singleSelectedItem.id}?print=true`)}
            disabled={!singleSelectedItem}
            title="Imprimir"
            data-testid="print-vistoria-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Printer className="w-4 h-4 text-green-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)}
            disabled={!singleSelectedItem}
            title="Excluir"
            data-testid="delete-vistoria-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 pl-1 pr-2">
              {selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Lista */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Vistorias ({pagination.total})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : filteredVistorias.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Nenhuma vistoria encontrada</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="w-9 px-4 py-2.5">
                        <Checkbox
                          checked={filteredVistorias.length > 0 && filteredVistorias.every(v => selectedIds.has(v.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                          data-testid="select-all-checkbox"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Container</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Estado</th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Fotos</th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Criado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVistorias.map((vistoria, idx) => (
                      <tr
                        key={vistoria.id}
                        onClick={() => toggleSelect(vistoria.id)}
                        className={`cursor-pointer transition-colors ${selectedIds.has(vistoria.id) ? 'bg-primary/10 hover:bg-primary/15' : `hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                        data-testid={`vistoria-row-${vistoria.id}`}
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(vistoria.id)}
                            onCheckedChange={() => toggleSelect(vistoria.id)}
                            data-testid="vistoria-row-checkbox"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{vistoria.vistoria_number}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">{vistoria.container_number}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{vistoria.client_name || '-'}</td>
                        <td className="hidden sm:table-cell px-4 py-2.5">
                          {vistoria.no_damage ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700">
                              Sem Avarias
                            </span>
                          ) : (vistoria.damage_items || []).length > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700">
                              {vistoria.damage_items.length} serviço{vistoria.damage_items.length > 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">-</span>
                          )}
                        </td>
                        <td className="hidden sm:table-cell px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            getPhotoCount(vistoria) > 0 ? 'bg-emerald-50 text-emerald-700' :
                            'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                          }`}>
                            {getPhotoCount(vistoria)}/12
                          </span>
                        </td>
                        <td className="hidden sm:table-cell px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                          {format(new Date(vistoria.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginação */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs text-slate-400 dark:text-slate-500">Página {pagination.page} de {pagination.totalPages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === 1} onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}>
                    Anterior
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === pagination.totalPages} onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}>
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
