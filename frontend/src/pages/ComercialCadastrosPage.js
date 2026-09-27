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
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { useModuleConfig } from '../context/ModuleConfigContext';
import { Plus, Trash2, Edit, UserCog } from 'lucide-react';

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
      <div className="space-y-4" data-testid="comercial-cadastros-page">
        <PageHeader icon={activeType.icon} title={`Cadastro de ${activeType.label}`} subtitle="Cadastros de apoio do módulo Comercial" />

        {/* Troca de cadastro (os mesmos itens do menu Comercial) */}
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
                  data-testid={`comercial-cadastro-type-${t.key}`}
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

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label={activeType.listColumns.filter(([f]) => f !== 'status').map(([, l]) => l).join(', ')}>
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-comercial-cadastro-input" />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um registro pra habilitar as ações da barra */}
        <DataCard
          title={activeType.plural}
          count={loading ? '...' : filteredItems.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label={`${activeType.feminine ? 'Nova' : 'Novo'} ${activeType.label.toLowerCase()}`} onClick={openCreateDialog} testId="add-comercial-cadastro-button" />}
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
                        data-testid="select-all-checkbox"
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
                        data-testid="comercial-cadastro-row"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(item.id)}
                            data-testid="comercial-cadastro-row-checkbox"
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
