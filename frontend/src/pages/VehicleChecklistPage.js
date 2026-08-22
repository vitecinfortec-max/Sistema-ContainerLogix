import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import {
  ClipboardCheck, Plus, Eye, Pencil, Trash2, Printer, Search, X, CheckCircle2, XCircle, AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Componente Autocomplete (mesmo padrão usado em Programação de Carregamento)
function Autocomplete({ value, onChange, options, placeholder, displayField = 'name', valueField = 'id', onSelect, className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');
  const [filteredOptions, setFilteredOptions] = useState([]);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  useEffect(() => {
    if (inputValue.length > 0) {
      const filtered = options.filter(opt => {
        const display = typeof displayField === 'function' ? displayField(opt) : opt[displayField];
        return display?.toLowerCase().includes(inputValue.toLowerCase());
      });
      setFilteredOptions(filtered.slice(0, 10));
    } else {
      setFilteredOptions(options.slice(0, 10));
    }
  }, [inputValue, options, displayField]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
    setIsOpen(true);
  };

  const handleSelect = (option) => {
    const display = typeof displayField === 'function' ? displayField(option) : option[displayField];
    setInputValue(display);
    onChange(display);
    if (onSelect) onSelect(option);
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        className={`h-9 ${className}`}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
      />
      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border rounded-md shadow-lg max-h-48 overflow-auto">
          {filteredOptions.map((option, idx) => {
            const display = typeof displayField === 'function' ? displayField(option) : option[displayField];
            return (
              <div
                key={option[valueField] || idx}
                className="px-3 py-2 cursor-pointer hover:bg-muted text-sm"
                onClick={() => handleSelect(option)}
              >
                {display}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Toggle SIM/NÃO compacto por item
function SimNaoToggle({ value, onChange, testId }) {
  return (
    <div className="flex gap-1 flex-shrink-0">
      <button
        type="button"
        data-testid={testId ? `${testId}-sim` : undefined}
        onClick={() => onChange(value === 'SIM' ? null : 'SIM')}
        className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
          value === 'SIM'
            ? 'bg-green-600 border-green-600 text-white'
            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-green-400'
        }`}
      >
        Sim
      </button>
      <button
        type="button"
        data-testid={testId ? `${testId}-nao` : undefined}
        onClick={() => onChange(value === 'NAO' ? null : 'NAO')}
        className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
          value === 'NAO'
            ? 'bg-red-600 border-red-600 text-white'
            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-red-400'
        }`}
      >
        Não
      </button>
    </div>
  );
}

// Cliente cujo checklist deve seguir exatamente o modelo LVT da Petrobras (mesmos campos,
// mesmo texto e estrutura do documento oficial). Qualquer outro cliente usa o checklist padrão.
const PETROBRAS_LVT_CLIENT_MATCH = 'MANUPORT';

const emptyForm = {
  template: 'generic',
  expedidor: '',
  un: '',
  inspection_datetime: '',
  scheduling_code: '',
  un_address: '',
  phone: '',
  fax: '',
  client_id: '',
  client_name: '',
  orp_odp_number: '',
  nf_number: '',
  transport_company_id: '',
  transport_company_name: '',
  driver_id: '',
  driver_name: '',
  driver_cpf: '',
  products_description: '',
  cavalo_plate: '',
  cavalo_year: '',
  carreta1_plate: '',
  carreta1_year: '',
  carreta1_capacity: '',
  carreta2_plate: '',
  carreta2_year: '',
  carreta2_capacity: '',
  cnh_number: '',
  cnh_category: '',
  cnh_expiry: '',
  sap_code: '',
  documentos_items: [],
  vehicle_condition_items: [],
  epi_items: [],
  kit_items: [],
  tank_items: [],
  post_loading_items: [],
  products: [],
  kit_validity_1: '',
  kit_validity_2: '',
  kit_validity_3: '',
  last_trip_product_1: '',
  last_trip_product_2: '',
  last_trip_product_3: '',
  observations: '',
  transport_responsible_name: '',
  transport_responsible_rg: '',
  lvt_receiver_name: '',
  lvt_receiver_registration: '',
  inspection_responsible_name: '',
  inspection_responsible_registration: '',
  merit_record: '',
  occurrence_record: '',
  driver_document: '',
  release_datetime: '',
};

const SECTION_FIELD_BY_KEY = {
  documentos: 'documentos_items',
  vehicle_condition: 'vehicle_condition_items',
  epi: 'epi_items',
  kit: 'kit_items',
  tank: 'tank_items',
  post_loading: 'post_loading_items',
};

export default function VehicleChecklistPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [template, setTemplate] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingChecklist, setEditingChecklist] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm);

  // Passo inicial: perguntar o cliente antes de abrir o formulário completo,
  // pra decidir se usa o modelo Petrobras/LVT (Manuport) ou o modelo padrão
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [pickerClientName, setPickerClientName] = useState('');
  const [pickerClientId, setPickerClientId] = useState('');

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedChecklist, setSelectedChecklist] = useState(null);

  useEffect(() => {
    loadChecklists();
    loadSelectData();
  }, [pagination.page]);

  const loadSelectData = async () => {
    try {
      const [clientsRes, companiesRes, driversRes, vehiclesRes, templateRes] = await Promise.all([
        api.getClients(),
        api.getCompanies(),
        api.getDrivers(),
        api.getVehicles({ per_page: 200 }),
        api.getVehicleChecklistTemplate(),
      ]);
      setClients(clientsRes.data);
      setCompanies(companiesRes.data);
      setDrivers(driversRes.data);
      setVehicles(vehiclesRes.data.items || []);
      setTemplate(templateRes.data.sections || []);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast.error('Erro ao carregar dados');
    }
  };

  const loadChecklists = async (search = '') => {
    setLoading(true);
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (search) params.search = search;
      const response = await api.getVehicleChecklists(params);
      setChecklists(response.data.items);
      setPagination(prev => ({ ...prev, pages: response.data.pages, total: response.data.total }));
    } catch (error) {
      toast.error('Erro ao carregar checklists');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadChecklists(searchQuery);
  };

  const cavalos = vehicles.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');
  const carretas = vehicles.filter(v => v.vehicle_type === 'CARRETA');

  const buildItemsFromTemplate = () => {
    const result = {};
    template.forEach(section => {
      result[SECTION_FIELD_BY_KEY[section.key]] = section.items.map(text => ({ text, answer: null, expiry: null }));
    });
    return result;
  };

  const resetForm = () => {
    setFormData({ ...emptyForm, ...buildItemsFromTemplate() });
    setEditingChecklist(null);
  };

  const openNewModal = () => {
    resetForm();
    setPickerClientName('');
    setPickerClientId('');
    setClientPickerOpen(true);
  };

  const confirmClientPicker = () => {
    if (!pickerClientName.trim()) {
      toast.error('Selecione ou digite o cliente');
      return;
    }
    const isPetrobrasLvt = pickerClientName.toUpperCase().includes(PETROBRAS_LVT_CLIENT_MATCH);
    setFormData(prev => ({
      ...prev,
      client_id: pickerClientId,
      client_name: pickerClientName,
      template: isPetrobrasLvt ? 'petrobras_lvt' : 'generic',
      expedidor: isPetrobrasLvt ? 'Petróleo Brasileiro S.A.' : prev.expedidor,
    }));
    setClientPickerOpen(false);
    setModalOpen(true);
  };

  const openEditModal = (checklist) => {
    setEditingChecklist(checklist);
    setFormData({ ...emptyForm, ...checklist });
    setModalOpen(true);
  };

  const viewDetails = (checklist) => {
    setSelectedChecklist(checklist);
    setDetailModalOpen(true);
  };

  const updateItem = (sectionField, index, patch) => {
    setFormData(prev => {
      const items = [...prev[sectionField]];
      items[index] = { ...items[index], ...patch };
      return { ...prev, [sectionField]: items };
    });
  };

  const addProduct = () => {
    setFormData(prev => ({ ...prev, products: [...prev.products, { product: '', un_number: '', risk_number: '', subclass: '' }] }));
  };

  const updateProduct = (index, field, value) => {
    setFormData(prev => {
      const products = [...prev.products];
      products[index] = { ...products[index], [field]: value };
      return { ...prev, products };
    });
  };

  const removeProduct = (index) => {
    setFormData(prev => ({ ...prev, products: prev.products.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async () => {
    if (!formData.driver_name || !formData.cavalo_plate) {
      toast.error('Preencha ao menos o motorista e a placa do cavalo');
      return;
    }
    setSaving(true);
    try {
      if (editingChecklist) {
        await api.updateVehicleChecklist(editingChecklist.id, formData);
        toast.success('Checklist atualizado com sucesso!');
      } else {
        await api.createVehicleChecklist(formData);
        toast.success('Checklist criado com sucesso!');
      }
      setModalOpen(false);
      resetForm();
      loadChecklists();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar checklist');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir este checklist?'))) return;
    try {
      await api.deleteVehicleChecklist(id);
      toast.success('Checklist excluído!');
      loadChecklists();
    } catch (error) {
      toast.error('Erro ao excluir');
    }
  };

  const handlePrint = async (id) => {
    try {
      const response = await api.getVehicleChecklistPDF(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `checklist_veiculo_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const checklistStatus = (checklist) => {
    const allItems = [
      ...(checklist.documentos_items || []),
      ...(checklist.vehicle_condition_items || []),
      ...(checklist.epi_items || []),
      ...(checklist.kit_items || []),
      ...(checklist.tank_items || []),
      ...(checklist.post_loading_items || []),
    ];
    if (allItems.some(i => i.answer === 'NAO')) return 'REPROVADO';
    if (allItems.length > 0 && allItems.every(i => i.answer === 'SIM')) return 'APROVADO';
    return 'PENDENTE';
  };

  const statusBadge = (status) => {
    const styles = {
      APROVADO: 'bg-green-100 text-green-800',
      REPROVADO: 'bg-red-100 text-red-800',
      PENDENTE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${styles[status]}`}>
        {status}
      </span>
    );
  };

  const renderItemsSection = (sectionKey, label) => {
    const fieldName = SECTION_FIELD_BY_KEY[sectionKey];
    const items = formData[fieldName] || [];
    if (items.length === 0) return null;
    const hasExpiry = sectionKey === 'documentos';

    return (
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-primary/10 px-4 py-2">
          <h4 className="text-sm font-semibold text-primary">{label}</h4>
        </div>
        <div className="divide-y">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-xs text-slate-400 dark:text-slate-500 w-5 flex-shrink-0">{idx + 1}</span>
              <span className="text-sm flex-1">{item.text}</span>
              {hasExpiry && (
                <Input
                  type="date"
                  value={item.expiry || ''}
                  onChange={(e) => updateItem(fieldName, idx, { expiry: e.target.value })}
                  className="h-8 w-40 text-xs flex-shrink-0"
                  data-testid={`checklist-item-expiry-${sectionKey}-${idx}`}
                />
              )}
              <SimNaoToggle
                value={item.answer}
                onChange={(v) => updateItem(fieldName, idx, { answer: v })}
                testId={`checklist-item-${sectionKey}-${idx}`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4" />
              Checklist de Veículo
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Lista de Verificação de Transporte (LVT) para inspeção do veículo antes do carregamento</p>
          </div>
          <Button onClick={openNewModal} data-testid="new-checklist-button">
            <Plus className="w-4 h-4 mr-2" />
            Novo Checklist
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar por placa, motorista ou cliente..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="h-9"
              />
              <Button variant="outline" onClick={handleSearch} className="h-9">
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : checklists.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Nenhum checklist encontrado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Motorista</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklists.map((c, idx) => (
                      <tr key={c.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}>
                        <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{c.checklist_number}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{c.driver_name || '-'}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-slate-600 dark:text-slate-400">{c.cavalo_plate || '-'}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">
                          {c.client_name || '-'}
                          {c.template === 'petrobras_lvt' && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-green-100 text-green-800 align-middle">LVT</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                          {c.created_at ? format(new Date(c.created_at), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                        </td>
                        <td className="px-4 py-2.5">{statusBadge(checklistStatus(c))}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-0.5">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => viewDetails(c)} title="Ver detalhes">
                              <Eye className="w-3.5 h-3.5 text-primary" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditModal(c)} title="Editar">
                              <Pencil className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handlePrint(c.id)} title="Imprimir PDF">
                              <Printer className="w-3.5 h-3.5 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDelete(c.id)} title="Excluir">
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs text-slate-400 dark:text-slate-500">Página {pagination.page} de {pagination.pages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === 1} onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}>Anterior</Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === pagination.pages} onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}>Próximo</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Passo 1: escolher o cliente antes de abrir o formulário completo */}
      <Dialog open={clientPickerOpen} onOpenChange={setClientPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              Novo Checklist de Veículo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Para qual cliente é esse checklist? *</Label>
            <Autocomplete
              value={pickerClientName}
              onChange={(val) => { setPickerClientName(val); setPickerClientId(''); }}
              options={clients}
              placeholder="Digite o nome do cliente..."
              displayField="name"
              onSelect={(c) => { setPickerClientId(c.id); setPickerClientName(c.name); }}
            />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Se o cliente for a Manuport, o checklist segue exatamente o modelo LVT da Petrobras. Para os demais clientes, é usado o checklist padrão do sistema.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClientPickerOpen(false)}>Cancelar</Button>
            <Button onClick={confirmClientPicker} data-testid="client-picker-continue">Continuar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Criar/Editar */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) resetForm(); setModalOpen(open); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              {editingChecklist ? 'Editar Checklist de Veículo' : 'Novo Checklist de Veículo'}
              {formData.template === 'petrobras_lvt' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-800">
                  Modelo Petrobras (LVT)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Informações Gerais */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Informações Gerais</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Expedidor</Label>
                  <Input
                    value={formData.expedidor}
                    onChange={(e) => setFormData(prev => ({ ...prev, expedidor: e.target.value }))}
                    placeholder="Ex: Petróleo Brasileiro S.A."
                    disabled={formData.template === 'petrobras_lvt'}
                  />
                </div>
                <div>
                  <Label>UN</Label>
                  <Input value={formData.un} onChange={(e) => setFormData(prev => ({ ...prev, un: e.target.value }))} />
                </div>
                <div>
                  <Label>Cód. Agendamento</Label>
                  <Input value={formData.scheduling_code} onChange={(e) => setFormData(prev => ({ ...prev, scheduling_code: e.target.value }))} />
                </div>
                <div>
                  <Label>Data e Hora da Vistoria</Label>
                  <Input type="datetime-local" value={formData.inspection_datetime} onChange={(e) => setFormData(prev => ({ ...prev, inspection_datetime: e.target.value }))} />
                </div>
                <div>
                  <Label>Endereço da UN</Label>
                  <Input value={formData.un_address} onChange={(e) => setFormData(prev => ({ ...prev, un_address: e.target.value }))} />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input value={formData.phone} onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))} />
                </div>
                <div>
                  <Label>Fax</Label>
                  <Input value={formData.fax} onChange={(e) => setFormData(prev => ({ ...prev, fax: e.target.value }))} />
                </div>
                <div>
                  <Label>Cliente</Label>
                  <Autocomplete
                    value={formData.client_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, client_name: val, client_id: '' }))}
                    options={clients}
                    placeholder="Digite o nome do cliente..."
                    displayField="name"
                    onSelect={(c) => setFormData(prev => ({ ...prev, client_id: c.id, client_name: c.name }))}
                  />
                </div>
                <div>
                  <Label>Transportadora</Label>
                  <Autocomplete
                    value={formData.transport_company_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, transport_company_name: val, transport_company_id: '' }))}
                    options={companies}
                    placeholder="Digite o nome da transportadora..."
                    displayField="name"
                    onSelect={(c) => setFormData(prev => ({ ...prev, transport_company_id: c.id, transport_company_name: c.name }))}
                  />
                </div>
                <div>
                  <Label>Número ORP / ODP</Label>
                  <Input value={formData.orp_odp_number} onChange={(e) => setFormData(prev => ({ ...prev, orp_odp_number: e.target.value }))} />
                </div>
                <div>
                  <Label>Número da NF (Descarga)</Label>
                  <Input value={formData.nf_number} onChange={(e) => setFormData(prev => ({ ...prev, nf_number: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto(s)</Label>
                  <Input value={formData.products_description} onChange={(e) => setFormData(prev => ({ ...prev, products_description: e.target.value }))} />
                </div>
                <div>
                  <Label>Código SAP</Label>
                  <Input value={formData.sap_code} onChange={(e) => setFormData(prev => ({ ...prev, sap_code: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Motorista e Veículo */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Motorista e Veículo</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Motorista *</Label>
                  <Autocomplete
                    value={formData.driver_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, driver_name: val, driver_id: '' }))}
                    options={drivers}
                    placeholder="Digite o nome..."
                    displayField="name"
                    onSelect={(d) => setFormData(prev => ({ ...prev, driver_id: d.id, driver_name: d.name, driver_cpf: d.cpf || '' }))}
                  />
                </div>
                <div>
                  <Label>CPF do Motorista</Label>
                  <Input value={formData.driver_cpf} onChange={(e) => setFormData(prev => ({ ...prev, driver_cpf: e.target.value }))} />
                </div>
                <div>
                  <Label>Nº CNH / Categoria</Label>
                  <div className="flex gap-2">
                    <Input value={formData.cnh_number} onChange={(e) => setFormData(prev => ({ ...prev, cnh_number: e.target.value }))} placeholder="Número" />
                    <Input value={formData.cnh_category} onChange={(e) => setFormData(prev => ({ ...prev, cnh_category: e.target.value.toUpperCase() }))} placeholder="Cat." className="w-20" />
                  </div>
                </div>
                <div>
                  <Label>Vencimento CNH</Label>
                  <Input type="date" value={formData.cnh_expiry} onChange={(e) => setFormData(prev => ({ ...prev, cnh_expiry: e.target.value }))} />
                </div>
                <div>
                  <Label>Placa do Cavalo *</Label>
                  <Autocomplete
                    value={formData.cavalo_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, cavalo_plate: val.toUpperCase() }))}
                    options={cavalos}
                    placeholder="Digite a placa..."
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, cavalo_plate: v.plate, cavalo_year: v.year ? String(v.year) : prev.cavalo_year }))}
                  />
                </div>
                <div>
                  <Label>Ano de Fabricação do Cavalo</Label>
                  <Input value={formData.cavalo_year} onChange={(e) => setFormData(prev => ({ ...prev, cavalo_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Placa Carreta 1</Label>
                  <Autocomplete
                    value={formData.carreta1_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, carreta1_plate: val.toUpperCase() }))}
                    options={carretas}
                    placeholder="Digite a placa..."
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, carreta1_plate: v.plate, carreta1_year: v.year ? String(v.year) : prev.carreta1_year }))}
                  />
                </div>
                <div>
                  <Label>Ano Carreta 1</Label>
                  <Input value={formData.carreta1_year} onChange={(e) => setFormData(prev => ({ ...prev, carreta1_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Capacidade Carreta 1</Label>
                  <Input value={formData.carreta1_capacity} onChange={(e) => setFormData(prev => ({ ...prev, carreta1_capacity: e.target.value }))} placeholder="Volume e/ou Peso" />
                </div>
                <div>
                  <Label>Placa Carreta 2</Label>
                  <Autocomplete
                    value={formData.carreta2_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, carreta2_plate: val.toUpperCase() }))}
                    options={carretas}
                    placeholder="Digite a placa..."
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, carreta2_plate: v.plate, carreta2_year: v.year ? String(v.year) : prev.carreta2_year }))}
                  />
                </div>
                <div>
                  <Label>Ano Carreta 2</Label>
                  <Input value={formData.carreta2_year} onChange={(e) => setFormData(prev => ({ ...prev, carreta2_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Capacidade Carreta 2</Label>
                  <Input value={formData.carreta2_capacity} onChange={(e) => setFormData(prev => ({ ...prev, carreta2_capacity: e.target.value }))} placeholder="Volume e/ou Peso" />
                </div>
              </div>
            </div>

            {/* Itens do checklist */}
            <div className="space-y-4">
              <h3 className="font-semibold">Itens de Verificação</h3>
              {renderItemsSection('documentos', 'Documentos')}
              {renderItemsSection('vehicle_condition', 'Condições do Veículo')}
              {renderItemsSection('epi', 'EPI')}
              {renderItemsSection('kit', 'Kit')}
              {renderItemsSection('tank', 'Condições do Tanque / Carreta')}
              {renderItemsSection('post_loading', 'Documentos Pós Carregamento')}
            </div>

            {/* Produtos */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Produtos Transportados</h3>
                <Button type="button" variant="outline" size="sm" onClick={addProduct}>
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar Produto
                </Button>
              </div>
              {formData.products.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum produto adicionado</p>
              ) : (
                <div className="space-y-2">
                  {formData.products.map((p, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <Input className="col-span-5 h-9" placeholder="Produto" value={p.product} onChange={(e) => updateProduct(idx, 'product', e.target.value)} />
                      <Input className="col-span-2 h-9" placeholder="ONU" value={p.un_number} onChange={(e) => updateProduct(idx, 'un_number', e.target.value)} />
                      <Input className="col-span-2 h-9" placeholder="Nº Risco" value={p.risk_number} onChange={(e) => updateProduct(idx, 'risk_number', e.target.value)} />
                      <Input className="col-span-2 h-9" placeholder="Subclasse" value={p.subclass} onChange={(e) => updateProduct(idx, 'subclass', e.target.value)} />
                      <Button type="button" variant="ghost" size="sm" className="col-span-1 h-9 w-9 p-0" onClick={() => removeProduct(idx)}>
                        <X className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Kit / Últimas viagens */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Kit de Emergência e Histórico</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Validade Calço/Extintor 1</Label>
                  <Input type="date" value={formData.kit_validity_1} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_1: e.target.value }))} />
                </div>
                <div>
                  <Label>Validade 2</Label>
                  <Input type="date" value={formData.kit_validity_2} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_2: e.target.value }))} />
                </div>
                <div>
                  <Label>Validade 3</Label>
                  <Input type="date" value={formData.kit_validity_3} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_3: e.target.value }))} />
                </div>
                <div>
                  <Label>Últ. Viagem - Produto 1</Label>
                  <Input value={formData.last_trip_product_1} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_1: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto 2</Label>
                  <Input value={formData.last_trip_product_2} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_2: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto 3</Label>
                  <Input value={formData.last_trip_product_3} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_3: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Observações */}
            <div>
              <Label>Observações</Label>
              <Textarea value={formData.observations} onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))} placeholder="Registro de observações" />
            </div>

            {/* Responsáveis */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Responsáveis</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Responsável da Transportadora</Label>
                  <Input value={formData.transport_responsible_name} onChange={(e) => setFormData(prev => ({ ...prev, transport_responsible_name: e.target.value }))} placeholder="Nome" />
                </div>
                <div>
                  <Label>RG</Label>
                  <Input value={formData.transport_responsible_rg} onChange={(e) => setFormData(prev => ({ ...prev, transport_responsible_rg: e.target.value }))} />
                </div>
                <div>
                  <Label>Recebedor da LVT</Label>
                  <Input value={formData.lvt_receiver_name} onChange={(e) => setFormData(prev => ({ ...prev, lvt_receiver_name: e.target.value }))} placeholder="Nome" />
                </div>
                <div>
                  <Label>Matrícula</Label>
                  <Input value={formData.lvt_receiver_registration} onChange={(e) => setFormData(prev => ({ ...prev, lvt_receiver_registration: e.target.value }))} />
                </div>
                <div>
                  <Label>Responsável pela Vistoria</Label>
                  <Input value={formData.inspection_responsible_name} onChange={(e) => setFormData(prev => ({ ...prev, inspection_responsible_name: e.target.value }))} placeholder="Nome" />
                </div>
                <div>
                  <Label>Matrícula</Label>
                  <Input value={formData.inspection_responsible_registration} onChange={(e) => setFormData(prev => ({ ...prev, inspection_responsible_registration: e.target.value }))} />
                </div>
                <div>
                  <Label>Registro de Mérito</Label>
                  <Input value={formData.merit_record} onChange={(e) => setFormData(prev => ({ ...prev, merit_record: e.target.value }))} />
                </div>
                <div>
                  <Label>Registro de Ocorrências</Label>
                  <Input value={formData.occurrence_record} onChange={(e) => setFormData(prev => ({ ...prev, occurrence_record: e.target.value }))} />
                </div>
                <div>
                  <Label>Documento do Condutor</Label>
                  <Input value={formData.driver_document} onChange={(e) => setFormData(prev => ({ ...prev, driver_document: e.target.value }))} />
                </div>
                <div>
                  <Label>Data/Hora da Liberação do Veículo</Label>
                  <Input type="datetime-local" value={formData.release_datetime} onChange={(e) => setFormData(prev => ({ ...prev, release_datetime: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : (editingChecklist ? 'Salvar Alterações' : 'Criar Checklist')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              Checklist #{selectedChecklist?.checklist_number}
              {selectedChecklist && statusBadge(checklistStatus(selectedChecklist))}
            </DialogTitle>
          </DialogHeader>

          {selectedChecklist && (
            <div className="space-y-4">
              {checklistStatus(selectedChecklist) === 'REPROVADO' && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Há item(ns) reprovado(s) — o carregamento deve ser cancelado.
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Motorista</p>
                  <p className="font-medium">{selectedChecklist.driver_name || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Placa do Cavalo</p>
                  <p className="font-medium">{selectedChecklist.cavalo_plate || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Cliente</p>
                  <p className="font-medium">{selectedChecklist.client_name || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Transportadora</p>
                  <p className="font-medium">{selectedChecklist.transport_company_name || '-'}</p>
                </div>
              </div>

              {[
                ['documentos_items', 'Documentos'],
                ['vehicle_condition_items', 'Condições do Veículo'],
                ['epi_items', 'EPI'],
                ['kit_items', 'Kit'],
                ['tank_items', 'Condições do Tanque / Carreta'],
                ['post_loading_items', 'Documentos Pós Carregamento'],
              ].map(([field, label]) => (
                (selectedChecklist[field] || []).length > 0 && (
                  <div key={field} className="border rounded-lg overflow-hidden">
                    <div className="bg-primary/10 px-4 py-2">
                      <h4 className="text-sm font-semibold text-primary">{label}</h4>
                    </div>
                    <div className="divide-y">
                      {selectedChecklist[field].map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-4 py-2 text-sm">
                          <span className="flex-1">{item.text}</span>
                          {item.answer === 'SIM' && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                          {item.answer === 'NAO' && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                          {!item.answer && <span className="text-xs text-slate-400">-</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ))}

              {selectedChecklist.observations && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block mb-1">Observações</span>
                  <span className="text-sm">{selectedChecklist.observations}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button onClick={() => { handlePrint(selectedChecklist.id); }}>
              <Printer className="w-4 h-4 mr-2" />
              Imprimir PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
