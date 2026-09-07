import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { useModuleConfig } from '../context/ModuleConfigContext';
import { Plus, Trash2, Edit, Search, UserCog } from 'lucide-react';

const STATUS_OPTIONS = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo']];

const formatCNPJ = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};
const formatPhone = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};
const formatCPF = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};
// Campo único "CNPJ ou CPF": aplica a máscara de CPF enquanto tiver até 11
// dígitos (senão um CPF saía formatado como CNPJ, ex. "026.496.043/28"
// em vez de "026.496.043-28"), e passa a formatar como CNPJ a partir do 12º.
const formatCnpjCpf = (value) => {
  const digits = value.replace(/\D/g, '');
  return digits.length > 11 ? formatCNPJ(value) : formatCPF(value);
};
const MASKS = { cnpj: formatCNPJ, doc: formatCnpjCpf, tel: formatPhone };

const TYPES = [
  {
    key: 'representante',
    label: 'Representante',
    plural: 'Representantes',
    icon: UserCog,
    moduleKey: 'comercial.representante',
    api: { list: api.getRepresentatives, create: api.createRepresentative, update: api.updateRepresentative, remove: api.deleteRepresentative },
    listColumns: [['name', 'Nome'], ['cnpj', 'CNPJ/CPF'], ['phone', 'Telefone'], ['status', 'Status']],
    fields: [
      { name: 'name', label: 'Nome', required: true },
      { name: 'cnpj', label: 'CNPJ ou CPF', mask: 'doc' },
      { name: 'phone', label: 'Telefone', mask: 'tel' },
      { name: 'email', label: 'Email' },
      { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
      { name: 'observations', label: 'Observações', type: 'textarea' },
    ],
  },
];

function buildEmptyForm(type) {
  const form = {};
  for (const f of type.fields) form[f.name] = f.name === 'status' ? 'ATIVO' : '';
  return form;
}

export default function ComercialCadastrosPage() {
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
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [formData, setFormData] = useState(() => buildEmptyForm(activeType));
  const [submitting, setSubmitting] = useState(false);

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
        setSelectedIds((prev) => {
          if (!prev.has(id)) return prev;
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

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredItems.map((item) => item.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const filteredItems = items.filter((item) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return activeType.listColumns.some(([field]) => (item[field] || '').toString().toLowerCase().includes(term));
  });

  const singleSelectedItem = selectedIds.size === 1 ? filteredItems.find((item) => item.id === [...selectedIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-5" data-testid="comercial-cadastros-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Cadastro</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Cadastros de apoio do módulo Comercial</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {availableTypes.map((t) => {
            const Icon = t.icon;
            const active = t.key === activeTypeKey;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTypeKey(t.key)}
                data-testid={`comercial-cadastro-type-${t.key}`}
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

        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">Cadastro de {activeType.label}</h2>
        </div>

        <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
          <DialogContent data-testid="comercial-cadastro-dialog">
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
                  ) : f.type === 'textarea' ? (
                    <Textarea value={formData[f.name] || ''} onChange={(e) => setField(f.name, e.target.value)} className="text-[13px] min-h-[70px]" />
                  ) : (
                    <Input
                      value={formData[f.name] || ''}
                      onChange={(e) => setField(f.name, f.mask ? MASKS[f.mask](e.target.value) : e.target.value)}
                      required={f.required}
                      className="h-10 text-[13px]"
                    />
                  )}
                </div>
              ))}
              <Button type="submit" className="w-full h-10 text-[13px] font-semibold" data-testid="submit-comercial-cadastro-button" disabled={submitting}>
                {submitting ? 'Salvando...' : (editId ? 'Atualizar' : 'Cadastrar')}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 text-[13px] pl-9" data-testid="search-comercial-cadastro-input" />
        </div>

        {/* Barra de ações - marque um registro na tabela abaixo pra habilitar as ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openCreateDialog}
            title="Adicionar"
            data-testid="add-comercial-cadastro-button"
            className="h-9 w-9 p-0"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && openEditDialog(singleSelectedItem)}
            disabled={!singleSelectedItem}
            title="Editar"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Edit className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedItem && handleDelete(singleSelectedItem.id)}
            disabled={!singleSelectedItem}
            title="Excluir"
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

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {loading ? 'Carregando...' : `Lista de ${activeType.plural} (${filteredItems.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b">
                    <tr>
                      <th className="w-9 px-4 py-2.5">
                        <Checkbox
                          checked={filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                          data-testid="select-all-checkbox"
                        />
                      </th>
                      {activeType.listColumns.map(([field, label]) => (
                        <th key={field} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredItems.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => toggleSelect(item.id)}
                        className={`cursor-pointer transition-colors ${selectedIds.has(item.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                        data-testid="comercial-cadastro-row"
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => toggleSelect(item.id)}
                            data-testid="comercial-cadastro-row-checkbox"
                          />
                        </td>
                        {activeType.listColumns.map(([field]) => (
                          <td key={field} className="px-4 py-2.5 text-[13px]">{item[field] || '-'}</td>
                        ))}
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
