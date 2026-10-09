import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, EmptyState,
} from '../components/DataPage';
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
import { Plus, Trash2, Edit, Warehouse, Package, Wrench } from 'lucide-react';

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
        toast.error(error.response?.data?.detail || `Erro ao deletar ${activeType.label.toLowerCase()}`);
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
      <div className="space-y-4" data-testid="estoque-cadastros-page">
        <PageHeader icon={activeType.icon} title={`Cadastro de ${activeType.label}`} subtitle="Cadastros de apoio do módulo Estoque" />

        {/* Troca de cadastro (os mesmos itens do menu Estoque > Cadastro) */}
        {availableTypes.length > 1 && (
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1">
            {availableTypes.map((t) => {
              const Icon = t.icon;
              const active = t.key === activeTypeKey;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTypeKey(t.key)}
                  data-testid={`estoque-cadastro-type-${t.key}`}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label={activeType.listColumns.filter(([f]) => f !== 'status').map(([, l]) => l).join(', ')}>
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-estoque-cadastro-input" />
            </FilterField>
          </div>
        </FilterCard>

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

        {/* Lista - marque um registro pra habilitar as ações da barra */}
        <DataCard
          title={activeType.plural}
          count={loading ? '...' : filteredItems.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label={`${activeType.feminine ? 'Nova' : 'Novo'} ${activeType.label.toLowerCase()}`} onClick={openCreateDialog} testId="add-estoque-cadastro-button" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={() => singleSelectedItem && openEditDialog(singleSelectedItem)} disabled={!singleSelectedItem} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)} disabled={!singleSelectedItem} />
            </Toolbar>
          )}
        >
          {filteredItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredItems.length > 0 && filteredItems.every(i => selectedIds.has(i.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    {activeType.listColumns.map(([field, label]) => (
                      <th key={field}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        data-selected={isSelected}
                        className="cursor-pointer"
                        onClick={() => toggleSelect(item.id)}
                        data-testid="estoque-cadastro-row"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(item.id)}
                          />
                        </td>
                        {activeType.listColumns.map(([field], colIdx) => (
                          <td key={field} className={colIdx === 0 ? 'cell-strong' : ''}>
                            {field === 'status' ? (
                              <StatusPill tone={item.status === 'INATIVO' ? 'slate' : 'emerald'}>
                                {item.status === 'INATIVO' ? 'Inativo' : 'Ativo'}
                              </StatusPill>
                            ) : (item[field] || '-')}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={activeType.icon}
              title={loading ? 'Carregando...' : (search ? 'Nenhum registro encontrado' : 'Nenhum registro cadastrado')}
              hint={loading ? undefined : (search ? 'Ajuste a busca' : `Cadastre pelo botão "${activeType.feminine ? 'Nova' : 'Novo'} ${activeType.label.toLowerCase()}"`)}
            />
          )}
        </DataCard>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
