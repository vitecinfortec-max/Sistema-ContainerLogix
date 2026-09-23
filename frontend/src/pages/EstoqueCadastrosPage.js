import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { useModuleConfig } from '../context/ModuleConfigContext';
import { Plus, Trash2, Edit, Search, Warehouse, Package, Wrench } from 'lucide-react';

const STATUS_OPTIONS = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo']];

const TYPES = [
  {
    key: 'almoxarifado',
    label: 'Almoxarifado',
    plural: 'Almoxarifados',
    icon: Warehouse,
    moduleKey: 'estoque.almoxarifado',
    api: { list: api.getWarehouses, create: api.createWarehouse, update: api.updateWarehouse, remove: api.deleteWarehouse },
    listColumns: [['name', 'Nome'], ['code', 'Código'], ['location', 'Localização'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Nome', required: true },
      { name: 'code', label: 'Código' },
      { name: 'location', label: 'Localização' },
      { name: 'responsible_name', label: 'Responsável' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
    ],
  },
  {
    key: 'familia-produto',
    label: 'Família de Produto',
    plural: 'Famílias de Produto',
    feminine: true,
    icon: Package,
    moduleKey: 'estoque.familia_produto',
    api: { list: api.getProductFamilies, create: api.createProductFamily, update: api.updateProductFamily, remove: api.deleteProductFamily },
    listColumns: [['name', 'Nome'], ['code', 'Código'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Nome', required: true },
      { name: 'code', label: 'Código' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
    ],
  },
  {
    key: 'familia-servico',
    label: 'Família de Serviço',
    plural: 'Famílias de Serviço',
    feminine: true,
    icon: Wrench,
    moduleKey: 'estoque.familia_servico',
    api: { list: api.getServiceFamilies, create: api.createServiceFamily, update: api.updateServiceFamily, remove: api.deleteServiceFamily },
    listColumns: [['name', 'Nome'], ['code', 'Código'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Nome', required: true },
      { name: 'code', label: 'Código' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
    ],
  },
];

function buildEmptyForm(type) {
  const form = {};
  for (const f of type.fields) form[f.name] = f.name === 'status' ? 'ATIVO' : '';
  return form;
}

export default function EstoqueCadastrosPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { isModuleEnabled } = useModuleConfig();
  const [searchParams, setSearchParams] = useSearchParams();

  const availableTypes = TYPES.filter((t) => isModuleEnabled(t.moduleKey));
  const initialTypeKey = searchParams.get('type') || availableTypes[0]?.key || TYPES[0].key;
  const [activeTypeKey, setActiveTypeKey] = useState(initialTypeKey);
  const activeType = TYPES.find((t) => t.key === activeTypeKey) || TYPES[0];

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState(() => buildEmptyForm(activeType));
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    setSearchParams(activeTypeKey === TYPES[0].key ? {} : { type: activeTypeKey }, { replace: true });
    setSelectedIds(new Set());
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTypeKey]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await activeType.api.list();
      setItems(response.data);
    } catch (error) {
      toast.error(`Erro ao carregar ${activeType.plural.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData(buildEmptyForm(activeType));
    setEditId(null);
  };

  const openCreateDialog = () => { resetForm(); setOpen(true); };

  const openEditDialog = (item) => {
    const form = buildEmptyForm(activeType);
    for (const f of activeType.fields) form[f.name] = item[f.name] ?? form[f.name];
    setFormData(form);
    setEditId(item.id);
    setOpen(true);
  };

  const setField = (name, value) => setFormData((p) => ({ ...p, [name]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (editId) {
        await activeType.api.update(editId, formData);
        toast.success(`${activeType.label} atualizado com sucesso`);
      } else {
        await activeType.api.create(formData);
        toast.success(`${activeType.label} cadastrado com sucesso`);
      }
      resetForm();
      setOpen(false);
      loadItems();
    } catch (error) {
      toast.error(error.response?.data?.detail || `Erro ao salvar ${activeType.label.toLowerCase()}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (await confirm(`Tem certeza que deseja deletar este registro de ${activeType.label.toLowerCase()}?`)) {
      try {
        await activeType.api.remove(id);
        toast.success(`${activeType.label} deletado com sucesso`);
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        loadItems();
      } catch (error) {
        toast.error(`Erro ao deletar ${activeType.label.toLowerCase()}`);
      }
    }
  };

  const filteredItems = items.filter((item) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return activeType.listColumns.some(([field]) => (item[field] || '').toString().toLowerCase().includes(term));
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds(prev => {
      const pageIds = filteredItems.map(i => i.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const singleSelectedItem = selectedIds.size === 1
    ? items.find(i => i.id === [...selectedIds][0])
    : null;

  return (
    <Layout>
      <div className="space-y-5" data-testid="estoque-cadastros-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Cadastro</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Cadastros de apoio do módulo Estoque</p>
        </div>

        <div className="grid grid-cols-3 gap-3 max-w-xl">
          {availableTypes.map((t) => {
            const Icon = t.icon;
            const active = t.key === activeTypeKey;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTypeKey(t.key)}
                data-testid={`estoque-cadastro-type-${t.key}`}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">Cadastro de {activeType.label}</h2>

        {/* Filtrar */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 text-[13px] pl-9" data-testid="search-estoque-cadastro-input" />
            </div>
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openCreateDialog}
            className="h-9 w-9 p-0"
            title={`${activeType.feminine ? 'Nova' : 'Novo'} ${activeType.label}`}
            data-testid="add-estoque-cadastro-button"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && openEditDialog(singleSelectedItem)}
            disabled={!singleSelectedItem}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Editar"
          >
            <Edit className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)}
            disabled={!singleSelectedItem}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Excluir"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 pr-1">
              {selectedIds.size} selecionado(s)
            </span>
          )}
        </div>

        <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
          <DialogContent data-testid="estoque-cadastro-dialog">
            <DialogHeader>
              <DialogTitle className="text-base">{editId ? `Editar ${activeType.label}` : `Cadastrar ${activeType.label}`}</DialogTitle>
              <DialogDescription className="text-[13px]">
                {editId ? `Atualize os dados` : `Adicione um novo registro`}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {activeType.fields.map((f) => (
                <div key={f.name} className="space-y-1.5">
                  <Label className="text-[13px]">{f.label}{f.required ? ' *' : ''}</Label>
                  {f.type === 'select' ? (
                    <Select value={formData[f.name] || f.options[0][0]} onValueChange={(v) => setField(f.name, v)}>
                      <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {f.options.map(([v, l]) => <SelectItem key={v} value={v} className="text-sm">{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={formData[f.name] || ''}
                      onChange={(e) => setField(f.name, e.target.value)}
                      required={f.required}
                      className="h-10 text-[13px]"
                    />
                  )}
                </div>
              ))}
              <Button type="submit" className="w-full h-10 text-[13px] font-semibold" data-testid="submit-estoque-cadastro-button" disabled={submitting}>
                {submitting ? 'Salvando...' : (editId ? 'Atualizar' : 'Cadastrar')}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <activeType.icon className="w-4 h-4" />
              {loading ? 'Carregando...' : `${activeType.plural} (${filteredItems.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left w-10">
                        <Checkbox
                          checked={filteredItems.length > 0 && filteredItems.every(i => selectedIds.has(i.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                        />
                      </th>
                      {activeType.listColumns.map(([field, label]) => (
                        <th key={field} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item, idx) => {
                      const isSelected = selectedIds.has(item.id);
                      return (
                        <tr
                          key={item.id}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 hover:bg-primary/15' : `hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                          onClick={() => toggleSelect(item.id)}
                          data-testid="estoque-cadastro-row"
                        >
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(item.id)}
                            />
                          </td>
                          {activeType.listColumns.map(([field]) => (
                            <td key={field} className="px-4 py-2.5 text-[13px]">{item[field] || '-'}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 dark:text-slate-400">
                <p className="text-[13px] font-medium">{search ? 'Nenhum registro encontrado' : 'Nenhum registro cadastrado'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
