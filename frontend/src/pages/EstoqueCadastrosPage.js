import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
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

  useEffect(() => {
    setSearchParams(activeTypeKey === TYPES[0].key ? {} : { type: activeTypeKey }, { replace: true });
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

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">Cadastro de {activeType.label}</h2>
          <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="default" className="text-[13px] font-semibold uppercase tracking-wide h-10" data-testid="add-estoque-cadastro-button" onClick={openCreateDialog}>
                <Plus className="w-4 h-4 mr-2" />
                {activeType.feminine ? 'Nova' : 'Novo'} {activeType.label}
              </Button>
            </DialogTrigger>
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
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 text-[13px] pl-9" data-testid="search-estoque-cadastro-input" />
        </div>

        <Card>
          <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
            <CardTitle className="text-[13px] font-medium">
              {loading ? 'Carregando...' : `${activeType.plural} (${filteredItems.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      {activeType.listColumns.map(([field, label]) => (
                        <th key={field} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</th>
                      ))}
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" data-testid="estoque-cadastro-row">
                        {activeType.listColumns.map(([field]) => (
                          <td key={field} className="px-4 py-2.5 text-[13px]">{item[field] || '-'}</td>
                        ))}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEditDialog(item)} title="Editar" className="h-8 w-8 p-0">
                              <Edit className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id)} title="Deletar" className="h-8 w-8 p-0">
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
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
