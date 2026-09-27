import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Plus, Trash2, Ship, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ShippingLinesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState({ name: '', code: '' });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadShippingLines();
  }, []);

  const loadShippingLines = async () => {
    try {
      const response = await api.getShippingLines();
      setLines(response.data);
    } catch (error) {
      toast.error('Erro ao carregar armadores');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', code: '' });
    setEditMode(false);
    setEditId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setOpen(true);
  };

  const openEditDialog = (line) => {
    setFormData({
      name: line.name,
      code: line.code || ''
    });
    setEditMode(true);
    setEditId(line.id);
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    
    setSubmitting(true);
    try {
      if (editMode && editId) {
        await api.updateShippingLine(editId, formData);
        toast.success('Armador atualizado com sucesso');
      } else {
        await api.createShippingLine(formData);
        toast.success('Armador cadastrado com sucesso');
      }
      resetForm();
      setOpen(false);
      loadShippingLines();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar armador');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm('Tem certeza que deseja deletar este armador?')) {
      try {
        await api.deleteShippingLine(id);
        toast.success('Armador deletado com sucesso');
        setSelectedIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        loadShippingLines();
      } catch (error) {
        toast.error('Erro ao deletar armador');
      }
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredLines.map(l => l.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const filteredLines = lines.filter((line) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      line.name?.toLowerCase().includes(term) ||
      line.code?.toLowerCase().includes(term)
    );
  });

  const singleSelectedLine = selectedIds.size === 1 ? filteredLines.find(l => l.id === [...selectedIds][0]) : null;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="shipping-lines-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="shipping-lines-page">
        <PageHeader icon={Ship} title="Armadores" subtitle="Gerencie o cadastro de armadores (shipping lines)" />

        <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) resetForm();
          }}>
            <DialogContent data-testid="line-dialog">
              <DialogHeader>
                <DialogTitle className="text-base">{editMode ? 'Editar Armador' : 'Cadastrar Armador'}</DialogTitle>
                <DialogDescription className="text-[13px]">
                  {editMode ? 'Atualize os dados do armador' : 'Adicione um novo armador ao sistema'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[13px]">Nome do Armador *</Label>
                  <Input
                    id="name"
                    data-testid="line-name-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-10 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="code" className="text-[13px]">Código</Label>
                  <Input
                    id="code"
                    data-testid="line-code-input"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="h-10 text-[13px] font-mono"
                    maxLength={10}
                  />
                </div>
                <Button 
                  type="submit" 
                  className="w-full h-10 text-[13px] font-semibold" 
                  data-testid="submit-line-button"
                  disabled={submitting}
                >
                  {submitting ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Nome ou código">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-line-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um armador pra habilitar as ações da barra */}
        <DataCard
          title="Armadores"
          count={filteredLines.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo armador" onClick={openCreateDialog} testId="add-line-button" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedLine && openEditDialog(singleSelectedLine)} disabled={!singleSelectedLine} testId="edit-line-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedLine && handleDelete(singleSelectedLine.id)} disabled={!singleSelectedLine} testId="delete-line-button" />
            </Toolbar>
          )}
        >
          {filteredLines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredLines.length > 0 && filteredLines.every(l => selectedIds.has(l.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nome</th>
                    <th>Código</th>
                    <th>Cadastrado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLines.map((line) => (
                    <tr
                      key={line.id}
                      onClick={() => toggleSelect(line.id)}
                      data-selected={selectedIds.has(line.id)}
                      className="cursor-pointer"
                      data-testid="line-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(line.id)}
                          onCheckedChange={() => toggleSelect(line.id)}
                          data-testid="line-row-checkbox"
                        />
                      </td>
                      <td className="cell-strong">{line.name}</td>
                      <td className="font-mono">{line.code || '-'}</td>
                      <td className="whitespace-nowrap tabular-nums">{format(new Date(line.created_at), 'dd/MM/yyyy', { locale: ptBR })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Ship}
              title={search ? 'Nenhum armador encontrado' : 'Nenhum armador cadastrado'}
              hint={search ? 'Ajuste a busca' : 'Cadastre o primeiro armador pelo botão "Novo armador"'}
              testId="no-lines"
            />
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
