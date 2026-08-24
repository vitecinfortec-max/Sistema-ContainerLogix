import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import {
  Plus, Pencil, Trash2, FileText, Download, Search, X, Save, Calculator,
} from 'lucide-react';

const buildEmptyForm = () => {
  return Object.freeze({
    // Dados do Contrato
    emission_date: '', payment_method: '', operation_type: '',
    trip_start_date: '', trip_end_date: '', agencia: '', talao: '',
    // Contratado
    contratado_id: '', contratado_name: '',
    // Motorista e Veículos
    driver_name: '', driver_cpf: '', driver_phone: '',
    truck_plate: '', truck_renavam: '', truck_owner: '', vehicle_type: '',
    trailer_plate: '', trailer_renavam: '', trailer_owner: '',
    trailer2_plate: '', trailer2_renavam: '', trailer2_owner: '',
    // Dados do Serviço
    service_local: '', service_date: '', service_type: 'CONTAINER',
    service_modality: 'LS', origin: '', destination: '',
    cte: '', weight: '',
    collection_date: '', delivery_date: '',
    container_number: '', client_name: '',
    // Frete Mínimo (campos manuais - sem cálculo automático)
    vehicle_composition: '', high_performance: false, freight_table: '',
    cargo_type: '', distance_km: '', axle_count: '',
    return_freight_type: '', return_km: '', minimum_freight: '',
    // Demonstrativo / Carga
    services: [{ description: '', value: 0 }],
    cargo_items: [],
    documents_list: '',
    // Valores
    rule: '', tolerance: '', driver_fee: '', collection_weight: '',
    service_value: 0, daily_rate: 0, other_discounts: '',
    inss_discount_percent: '', sest_senat_discount_percent: '',
    ir_calculation_base: '', irrf_discount: '', insurance_discount: '',
    toll_value: '', net_freight: '', advance: 0, advance_installments: '',
    fuel: 0, arrival_weight: '', weight_loss_discount: '', fuel_balance: '',
    complement: '', result: '', others: 0, discounts: 0,
    // Contratos anteriores
    inss_ceiling: '', contratado_monthly_inss_discount: '',
    // Dados de pagamento
    ciot: '',
    // Dados bancários
    bank_agency: '', bank_account: '', bank_pix: '', bank_beneficiary: '',
    observations: '',
  });
};

const fmtMoney = (v) => {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function RPATerceiroPage({ rpaType = 'terceiro' }) {
  const { confirm, ConfirmDialog } = useConfirm();

  const [rpas, setRpas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [nextNumber, setNextNumber] = useState(null);
  const [form, setForm] = useState(buildEmptyForm());
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  // Autocomplete de motorista
  const [drivers, setDrivers] = useState([]);
  const [driverSearch, setDriverSearch] = useState('');
  const [driverSuggestions, setDriverSuggestions] = useState([]);
  const [showDriverSuggestions, setShowDriverSuggestions] = useState(false);
  const driverBoxRef = useRef(null);

  // Autocomplete de cliente
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const clientBoxRef = useRef(null);

  // Autocomplete de contratado (transportadora subcontratada)
  const [companies, setCompanies] = useState([]);
  const [contratadoSearch, setContratadoSearch] = useState('');
  const [contratadoSuggestions, setContratadoSuggestions] = useState([]);
  const [showContratadoSuggestions, setShowContratadoSuggestions] = useState(false);
  const contratadoBoxRef = useRef(null);

  useEffect(() => { loadRpas(); loadDrivers(); loadClients(); loadCompanies(); }, [rpaType]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadRpas(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search]);

  // Fechar sugestões ao clicar fora
  useEffect(() => {
    const handleClick = (e) => {
      if (driverBoxRef.current && !driverBoxRef.current.contains(e.target)) {
        setShowDriverSuggestions(false);
      }
      if (clientBoxRef.current && !clientBoxRef.current.contains(e.target)) {
        setShowClientSuggestions(false);
      }
      if (contratadoBoxRef.current && !contratadoBoxRef.current.contains(e.target)) {
        setShowContratadoSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadClients = async () => {
    try {
      const r = await api.getClients();
      setClients(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar clientes:', e);
      toast.error('Erro ao carregar clientes');
    }
  };

  const loadCompanies = async () => {
    try {
      const r = await api.getCompanies();
      setCompanies(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar transportadoras:', e);
      toast.error('Erro ao carregar transportadoras');
    }
  };

  const handleClientSearch = (term) => {
    setClientSearch(term);
    setForm((prev) => ({ ...prev, client_name: term }));
    if (term && term.length >= 1) {
      const filtered = clients.filter((c) =>
        c.name.toLowerCase().includes(term.toLowerCase())
      );
      setClientSuggestions(filtered.slice(0, 12));
      setShowClientSuggestions(true);
    } else {
      setClientSuggestions([]);
      setShowClientSuggestions(false);
    }
  };

  const selectClient = (client) => {
    setClientSearch(client.name);
    setShowClientSuggestions(false);
    setForm((prev) => ({ ...prev, client_name: client.name }));
  };

  const clearClient = () => {
    setClientSearch('');
    setShowClientSuggestions(false);
    setForm((prev) => ({ ...prev, client_name: '' }));
  };

  const handleContratadoSearch = (term) => {
    setContratadoSearch(term);
    setForm((prev) => ({ ...prev, contratado_name: term, contratado_id: '' }));
    if (term && term.length >= 1) {
      const filtered = companies.filter((c) =>
        c.name.toLowerCase().includes(term.toLowerCase())
      );
      setContratadoSuggestions(filtered.slice(0, 12));
      setShowContratadoSuggestions(true);
    } else {
      setContratadoSuggestions([]);
      setShowContratadoSuggestions(false);
    }
  };

  const selectContratado = (company) => {
    setContratadoSearch(company.name);
    setShowContratadoSuggestions(false);
    setForm((prev) => ({ ...prev, contratado_id: company.id, contratado_name: company.name }));
  };

  const clearContratado = () => {
    setContratadoSearch('');
    setShowContratadoSuggestions(false);
    setForm((prev) => ({ ...prev, contratado_id: '', contratado_name: '' }));
  };

  const loadDrivers = async () => {
    try {
      const r = await api.getDrivers();
      setDrivers(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar motoristas:', e);
      toast.error('Erro ao carregar motoristas');
    }
  };

  const handleDriverSearch = (term) => {
    setDriverSearch(term);
    setForm((prev) => ({ ...prev, driver_name: term }));
    if (term && term.length >= 1) {
      const filtered = drivers.filter((d) =>
        d.name.toLowerCase().includes(term.toLowerCase()) ||
        (d.cpf || '').toLowerCase().includes(term.toLowerCase())
      );
      setDriverSuggestions(filtered.slice(0, 12));
      setShowDriverSuggestions(true);
    } else {
      setDriverSuggestions([]);
      setShowDriverSuggestions(false);
    }
  };

  const selectDriver = async (driver) => {
    setDriverSearch(driver.name);
    setShowDriverSuggestions(false);
    // Buscar info detalhada (CPF, telefone, última placa, transportadora)
    try {
      const r = await api.getRPADriverInfo(driver.id);
      const info = r.data || {};
      setForm((prev) => ({
        ...prev,
        driver_name: info.driver_name || driver.name,
        driver_cpf: info.driver_cpf || driver.cpf || prev.driver_cpf,
        driver_phone: info.driver_phone || driver.phone || prev.driver_phone,
        truck_plate: info.truck_plate || prev.truck_plate,
        trailer_plate: info.trailer_plate || prev.trailer_plate,
        truck_owner: info.truck_owner || prev.truck_owner,
      }));
      const filled = [];
      if (info.truck_plate) filled.push('Veículo Principal');
      if (info.trailer_plate) filled.push('Vinculado 01');
      if (info.truck_owner) filled.push('Proprietário');
      if (filled.length > 0) {
        toast.success(`Preenchido: CPF, telefone, ${filled.join(', ')}`);
      } else {
        toast.success('Motorista preenchido (sem movimentações anteriores)');
      }
    } catch (e) {
      // Sem info do backend - usar dados básicos do cadastro
      setForm((prev) => ({
        ...prev,
        driver_name: driver.name,
        driver_cpf: driver.cpf || prev.driver_cpf,
        driver_phone: driver.phone || prev.driver_phone,
      }));
    }
  };

  const clearDriver = () => {
    setDriverSearch('');
    setShowDriverSuggestions(false);
    setForm((prev) => ({
      ...prev, driver_name: '', driver_cpf: '', driver_phone: '',
    }));
  };

  const loadRpas = async () => {
    setLoading(true);
    try {
      const params = { rpa_type: rpaType };
      if (search) params.search = search;
      const r = await api.getRPATerceiros(params);
      setRpas(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar contratos');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setForm(buildEmptyForm());
  };

  const openCreate = async () => {
    resetForm();
    setEditingId(null);
    setDriverSearch('');
    setShowDriverSuggestions(false);
    setClientSearch('');
    setShowClientSuggestions(false);
    setContratadoSearch('');
    setShowContratadoSuggestions(false);
    try {
      const r = await api.getRPATerceiroNextNumber(rpaType);
      setNextNumber(r.data?.next_number || 1);
    } catch (e) {
      setNextNumber(null);
    }
    setDialogOpen(true);
  };

  const openEdit = async (id) => {
    try {
      const r = await api.getRPATerceiro(id);
      const d = r.data;
      setEditingId(id);
      setNextNumber(d.rpa_number);
      setForm({
        ...buildEmptyForm(),
        ...d,
        services: (d.services && d.services.length > 0) ? d.services : [{ description: '', value: 0 }],
        cargo_items: d.cargo_items || [],
        service_date: d.service_date || '',
        collection_date: d.collection_date || '',
        delivery_date: d.delivery_date || '',
        emission_date: d.emission_date || '',
        trip_start_date: d.trip_start_date || '',
        trip_end_date: d.trip_end_date || '',
      });
      setDriverSearch(d.driver_name || '');
      setShowDriverSuggestions(false);
      setClientSearch(d.client_name || '');
      setShowClientSuggestions(false);
      setContratadoSearch(d.contratado_name || '');
      setShowContratadoSuggestions(false);
      setDialogOpen(true);
    } catch (e) {
      toast.error('Erro ao carregar contrato');
    }
  };

  const onChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateService = (idx, field, value) => {
    setForm((prev) => {
      const services = [...prev.services];
      services[idx] = { ...services[idx], [field]: field === 'value' ? Number(value || 0) : value };
      // Recalcular service_value (soma dos serviços)
      const total = services.reduce((acc, s) => acc + Number(s.value || 0), 0);
      return { ...prev, services, service_value: total };
    });
  };

  const addService = () => {
    setForm((prev) => ({ ...prev, services: [...prev.services, { description: '', value: 0 }] }));
  };
  const removeService = (idx) => {
    setForm((prev) => {
      const services = prev.services.filter((_, i) => i !== idx);
      const total = services.reduce((acc, s) => acc + Number(s.value || 0), 0);
      return {
        ...prev,
        services: services.length ? services : [{ description: '', value: 0 }],
        service_value: total,
      };
    });
  };

  const addCargoItem = () => {
    setForm((prev) => ({
      ...prev,
      cargo_items: [...prev.cargo_items, {
        nf_number: '', fiscal_date: '', nature: '', species: '', mark: '',
        batch_number: '', quantity: '', weight_kg: '', cubage_m3: '', value: '',
      }],
    }));
  };
  const updateCargoItem = (idx, field, value) => {
    setForm((prev) => {
      const cargo_items = [...prev.cargo_items];
      cargo_items[idx] = { ...cargo_items[idx], [field]: value };
      return { ...prev, cargo_items };
    });
  };
  const removeCargoItem = (idx) => {
    setForm((prev) => ({ ...prev, cargo_items: prev.cargo_items.filter((_, i) => i !== idx) }));
  };

  const calcBalance = () => {
    const sv = Number(form.service_value || 0);
    const dr = Number(form.daily_rate || 0);
    const fu = Number(form.fuel || 0);
    const ad = Number(form.advance || 0);
    const ot = Number(form.others || 0);
    const de = Number(form.discounts || 0);
    return sv + dr + fu + ot - ad - de;
  };

  const handleSave = async () => {
    if (!form.driver_name?.trim()) {
      toast.error('Informe o nome do motorista');
      return;
    }
    setSaving(true);
    try {
      const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
      const payload = {
        ...form,
        rpa_type: rpaType,
        service_value: Number(form.service_value || 0),
        daily_rate: Number(form.daily_rate || 0),
        fuel: Number(form.fuel || 0),
        advance: Number(form.advance || 0),
        others: Number(form.others || 0),
        discounts: Number(form.discounts || 0),
        tolerance: numOrNull(form.tolerance),
        driver_fee: numOrNull(form.driver_fee),
        collection_weight: numOrNull(form.collection_weight),
        other_discounts: numOrNull(form.other_discounts),
        inss_discount_percent: numOrNull(form.inss_discount_percent),
        sest_senat_discount_percent: numOrNull(form.sest_senat_discount_percent),
        ir_calculation_base: numOrNull(form.ir_calculation_base),
        irrf_discount: numOrNull(form.irrf_discount),
        insurance_discount: numOrNull(form.insurance_discount),
        toll_value: numOrNull(form.toll_value),
        net_freight: numOrNull(form.net_freight),
        advance_installments: form.advance_installments === '' ? null : parseInt(form.advance_installments, 10),
        arrival_weight: numOrNull(form.arrival_weight),
        weight_loss_discount: numOrNull(form.weight_loss_discount),
        fuel_balance: numOrNull(form.fuel_balance),
        complement: numOrNull(form.complement),
        result: numOrNull(form.result),
        distance_km: numOrNull(form.distance_km),
        axle_count: form.axle_count === '' ? null : parseInt(form.axle_count, 10),
        return_km: numOrNull(form.return_km),
        minimum_freight: numOrNull(form.minimum_freight),
        inss_ceiling: numOrNull(form.inss_ceiling),
        contratado_monthly_inss_discount: numOrNull(form.contratado_monthly_inss_discount),
        services: form.services
          .filter((s) => s.description?.trim() || Number(s.value || 0) > 0)
          .map((s) => ({ description: s.description || '', value: Number(s.value || 0) })),
        cargo_items: form.cargo_items
          .filter((c) => Object.values(c).some((v) => v !== '' && v !== null))
          .map((c) => ({
            ...c,
            weight_kg: numOrNull(c.weight_kg),
            cubage_m3: numOrNull(c.cubage_m3),
            value: numOrNull(c.value),
          })),
      };
      if (editingId) {
        await api.updateRPATerceiro(editingId, payload);
        toast.success('Contrato atualizado!');
      } else {
        await api.createRPATerceiro(payload);
        toast.success('Contrato criado!');
      }
      setDialogOpen(false);
      loadRpas();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar contrato');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, num) => {
    if (!(await confirm(`Excluir Contrato Nº ${num}?`))) return;
    try {
      await api.deleteRPATerceiro(id);
      toast.success('Contrato excluído');
      loadRpas();
    } catch (e) {
      toast.error('Erro ao excluir');
    }
  };

  const downloadPDF = async (id, num) => {
    try {
      const r = await api.getRPATerceiroPDF(id);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `ContratoFrete_${num}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('PDF gerado!');
    } catch (e) {
      toast.error('Erro ao gerar PDF');
    }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="rpa-terceiro-page">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Contrato de Frete</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
              Contrato de Afretamento para motoristas terceiros
            </p>
          </div>
          <Button
            onClick={openCreate}
            className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90"
            data-testid="rpa-new-button"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Novo Contrato
          </Button>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700" />

        {/* Search */}
        <Card className="shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <Input
                placeholder="Buscar por motorista, cliente, container, placa..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-[13px]"
                data-testid="rpa-search-input"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* List */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {loading ? 'Carregando...' : `Lista de Contratos (${rpas.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead className="text-[12px] font-semibold">Nº</TableHead>
                    <TableHead className="text-[12px] font-semibold">Motorista</TableHead>
                    <TableHead className="text-[12px] font-semibold">CPF</TableHead>
                    <TableHead className="text-[12px] font-semibold">Cliente</TableHead>
                    <TableHead className="text-[12px] font-semibold">Container</TableHead>
                    <TableHead className="text-[12px] font-semibold">Data</TableHead>
                    <TableHead className="text-[12px] font-semibold text-right">Saldo</TableHead>
                    <TableHead className="text-[12px] font-semibold text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rpas.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">
                        Nenhum contrato cadastrado.
                      </TableCell>
                    </TableRow>
                  )}
                  {rpas.map((r) => (
                    <TableRow key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800" data-testid={`rpa-row-${r.rpa_number}`}>
                      <TableCell className="text-[13px] font-semibold text-primary">
                        Nº {r.rpa_number}
                      </TableCell>
                      <TableCell className="text-[13px]">{r.driver_name || '-'}</TableCell>
                      <TableCell className="text-[12px] text-slate-500 dark:text-slate-400">{r.driver_cpf || '-'}</TableCell>
                      <TableCell className="text-[13px]">{r.client_name || '-'}</TableCell>
                      <TableCell className="text-[12px] font-mono">{r.container_number || '-'}</TableCell>
                      <TableCell className="text-[12px]">
                        {r.service_date ? format(new Date(r.service_date), 'dd/MM/yyyy') : '-'}
                      </TableCell>
                      <TableCell className="text-[13px] font-semibold text-right text-primary">
                        {fmtMoney(r.balance)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => downloadPDF(r.id, r.rpa_number)}
                            className="h-8 px-2"
                            data-testid={`rpa-pdf-${r.rpa_number}`}
                            title="Baixar PDF"
                          >
                            <Download className="w-3.5 h-3.5 text-green-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(r.id)}
                            className="h-8 px-2"
                            data-testid={`rpa-edit-${r.rpa_number}`}
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(r.id, r.rpa_number)}
                            className="h-8 px-2"
                            data-testid={`rpa-delete-${r.rpa_number}`}
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialog Create/Edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="rpa-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              {editingId ? 'Editar Contrato de Frete' : 'Novo Contrato de Frete'}
              {nextNumber !== null && (
                <Badge variant="outline" className="ml-2 text-emerald-700 border-emerald-300">
                  Nº {nextNumber}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* DADOS DO CONTRATO */}
            <SectionHeader title="Dados do Contrato" noMargin />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data de Emissão" type="date" value={form.emission_date} onChange={(v) => onChange('emission_date', v)} testid="rpa-emission-date" />
              <Field label="Forma de Pagamento" value={form.payment_method} onChange={(v) => onChange('payment_method', v)} placeholder="Ex: Carta frete" testid="rpa-payment-method" />
              <Field label="Data Inicial da Viagem" type="date" value={form.trip_start_date} onChange={(v) => onChange('trip_start_date', v)} testid="rpa-trip-start" />
              <Field label="Data Final da Viagem" type="date" value={form.trip_end_date} onChange={(v) => onChange('trip_end_date', v)} testid="rpa-trip-end" />
              <Field label="Tipo de Operação" value={form.operation_type} onChange={(v) => onChange('operation_type', v)} testid="rpa-operation-type" />
              <Field label="Agência" value={form.agencia} onChange={(v) => onChange('agencia', v)} testid="rpa-agencia" />
              <Field label="Talão" value={form.talao} onChange={(v) => onChange('talao', v)} testid="rpa-talao" />
            </div>

            {/* CONTRATADO */}
            <SectionHeader title="Contratado" />
            <div className="grid grid-cols-2 gap-3">
              <div className="relative" ref={contratadoBoxRef}>
                <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">
                  Transportadora / Contratado <span className="text-emerald-600 normal-case font-normal">(digite para buscar cadastrados)</span>
                </Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Digite o nome da transportadora contratada..."
                    value={contratadoSearch}
                    onChange={(e) => handleContratadoSearch(e.target.value)}
                    onFocus={() => {
                      if (contratadoSearch.length >= 1 && contratadoSuggestions.length > 0) {
                        setShowContratadoSuggestions(true);
                      }
                    }}
                    className="h-9 text-sm pr-8"
                    data-testid="rpa-contratado-name"
                  />
                  {form.contratado_name && (
                    <button
                      type="button"
                      onClick={clearContratado}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {showContratadoSuggestions && contratadoSuggestions.length > 0 && (
                  <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {contratadoSuggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectContratado(c)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 focus:outline-none border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                      >
                        <div className="font-medium text-slate-800 dark:text-slate-200">{c.name}</div>
                        {c.cnpj && <div className="text-[11px] text-slate-500 dark:text-slate-400">CNPJ: {c.cnpj}</div>}
                      </button>
                    ))}
                  </div>
                )}
                {showContratadoSuggestions && contratadoSearch.length >= 1 && contratadoSuggestions.length === 0 && (
                  <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg px-3 py-2 text-[12px] text-slate-500 dark:text-slate-400">
                    Nenhuma transportadora cadastrada encontrada. Você pode digitar manualmente.
                  </div>
                )}
              </div>
            </div>

            {/* MOTORISTA E VEÍCULOS */}
            <SectionHeader title="Motorista e Veículos" />
            <div className="grid grid-cols-2 gap-3">
              {/* Motorista - Autocomplete */}
              <div className="relative" ref={driverBoxRef}>
                <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">
                  Motorista * <span className="text-emerald-600 normal-case font-normal">(digite para buscar cadastrados)</span>
                </Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Digite o nome ou CPF do motorista..."
                    value={driverSearch}
                    onChange={(e) => handleDriverSearch(e.target.value)}
                    onFocus={() => {
                      if (driverSearch.length >= 1 && driverSuggestions.length > 0) {
                        setShowDriverSuggestions(true);
                      }
                    }}
                    className={`h-9 text-sm pr-8 ${form.driver_name && drivers.some((d) => d.name === form.driver_name) ? 'border-emerald-500 bg-emerald-50' : ''}`}
                    data-testid="rpa-driver-name"
                  />
                  {form.driver_name && (
                    <button
                      type="button"
                      onClick={clearDriver}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                      data-testid="rpa-driver-clear"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {showDriverSuggestions && driverSuggestions.length > 0 && (
                  <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-y-auto" data-testid="rpa-driver-suggestions">
                    {driverSuggestions.map((driver) => (
                      <button
                        key={driver.id}
                        type="button"
                        onClick={() => selectDriver(driver)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 focus:outline-none border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                      >
                        <div className="font-medium text-slate-800 dark:text-slate-200">{driver.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          CPF: {driver.cpf || '-'}
                          {driver.phone ? ` · ${driver.phone}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {showDriverSuggestions && driverSearch.length >= 1 && driverSuggestions.length === 0 && (
                  <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg px-3 py-2 text-[12px] text-slate-500 dark:text-slate-400">
                    Nenhum motorista cadastrado encontrado. Você pode digitar manualmente.
                  </div>
                )}
              </div>
              <Field label="Telefone" value={form.driver_phone} onChange={(v) => onChange('driver_phone', v)} testid="rpa-driver-phone" />
              <Field label="CPF" value={form.driver_cpf} onChange={(v) => onChange('driver_cpf', v)} testid="rpa-driver-cpf" />
              <Field label="Tipo de Veículo Principal" value={form.vehicle_type} onChange={(v) => onChange('vehicle_type', v)} testid="rpa-vehicle-type" />
              <Field label="Veículo Principal (Placa)" value={form.truck_plate} onChange={(v) => onChange('truck_plate', v)} testid="rpa-truck-plate" />
              <Field label="Renavam" value={form.truck_renavam} onChange={(v) => onChange('truck_renavam', v)} testid="rpa-truck-renavam" />
              <Field label="Proprietário" value={form.truck_owner} onChange={(v) => onChange('truck_owner', v)} testid="rpa-truck-owner" />
              <Field label="Vinculado 01 (Placa)" value={form.trailer_plate} onChange={(v) => onChange('trailer_plate', v)} testid="rpa-trailer-plate" />
              <Field label="Renavam Vinculado 01" value={form.trailer_renavam} onChange={(v) => onChange('trailer_renavam', v)} testid="rpa-trailer-renavam" />
              <Field label="Proprietário Vinculado 01" value={form.trailer_owner} onChange={(v) => onChange('trailer_owner', v)} testid="rpa-trailer-owner" />
              <Field label="Vinculado 02 (Placa)" value={form.trailer2_plate} onChange={(v) => onChange('trailer2_plate', v)} testid="rpa-trailer2-plate" />
              <Field label="Renavam Vinculado 02" value={form.trailer2_renavam} onChange={(v) => onChange('trailer2_renavam', v)} testid="rpa-trailer2-renavam" />
              <Field label="Proprietário Vinculado 02" value={form.trailer2_owner} onChange={(v) => onChange('trailer2_owner', v)} testid="rpa-trailer2-owner" />
            </div>

            {/* DADOS DO SERVIÇO */}
            <SectionHeader title="Dados do Serviço Prestado" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Local" value={form.service_local} onChange={(v) => onChange('service_local', v)} testid="rpa-service-local" />
              <Field label="Data" type="date" value={form.service_date} onChange={(v) => onChange('service_date', v)} testid="rpa-service-date" />
              <Field label="Serviço" value={form.service_type} onChange={(v) => onChange('service_type', v)} testid="rpa-service-type" />
              <Field label="Tipo (LS/RODO)" value={form.service_modality} onChange={(v) => onChange('service_modality', v)} testid="rpa-service-modality" />
              <Field label="Origem / Local Coleta" value={form.origin} onChange={(v) => onChange('origin', v)} testid="rpa-origin" />
              <Field label="Destino / Local Entrega" value={form.destination} onChange={(v) => onChange('destination', v)} testid="rpa-destination" />
              <Field label="CTE" value={form.cte} onChange={(v) => onChange('cte', v)} testid="rpa-cte" />
              <Field label="Peso" value={form.weight} onChange={(v) => onChange('weight', v)} testid="rpa-weight" />
              <Field label="Data Coleta" type="date" value={form.collection_date} onChange={(v) => onChange('collection_date', v)} testid="rpa-collection-date" />
              <Field label="Data Entrega / Prazo Entrega" type="date" value={form.delivery_date} onChange={(v) => onChange('delivery_date', v)} testid="rpa-delivery-date" />
              <Field label="Nº Container" value={form.container_number} onChange={(v) => onChange('container_number', v)} testid="rpa-container-number" />
              {/* Cliente - Autocomplete */}
              <div className="relative" ref={clientBoxRef}>
                <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">
                  Cliente <span className="text-emerald-600 normal-case font-normal">(digite para buscar cadastrados)</span>
                </Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Digite o nome do cliente..."
                    value={clientSearch}
                    onChange={(e) => handleClientSearch(e.target.value)}
                    onFocus={() => {
                      if (clientSearch.length >= 1 && clientSuggestions.length > 0) {
                        setShowClientSuggestions(true);
                      }
                    }}
                    className={`h-9 text-sm pr-8 ${form.client_name && clients.some((c) => c.name === form.client_name) ? 'border-emerald-500 bg-emerald-50' : ''}`}
                    data-testid="rpa-client-name"
                  />
                  {form.client_name && (
                    <button
                      type="button"
                      onClick={clearClient}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                      data-testid="rpa-client-clear"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {showClientSuggestions && clientSuggestions.length > 0 && (
                  <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-y-auto" data-testid="rpa-client-suggestions">
                    {clientSuggestions.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => selectClient(client)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 focus:outline-none border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                      >
                        <div className="font-medium text-slate-800 dark:text-slate-200">{client.name}</div>
                        {client.cnpj && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">CNPJ: {client.cnpj}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {showClientSuggestions && clientSearch.length >= 1 && clientSuggestions.length === 0 && (
                  <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg px-3 py-2 text-[12px] text-slate-500 dark:text-slate-400">
                    Nenhum cliente cadastrado encontrado. Você pode digitar manualmente.
                  </div>
                )}
              </div>
            </div>

            {/* FRETE MÍNIMO */}
            <SectionHeader title="Informações para Cálculo do Frete Mínimo" />
            <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-2">
              Campos de preenchimento manual - o sistema não calcula automaticamente o frete mínimo ANTT.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Composição Veicular" value={form.vehicle_composition} onChange={(v) => onChange('vehicle_composition', v)} testid="rpa-vehicle-composition" />
              <Field label="Tabela de Frete" value={form.freight_table} onChange={(v) => onChange('freight_table', v)} testid="rpa-freight-table" />
              <Field label="Tipo de Carga" value={form.cargo_type} onChange={(v) => onChange('cargo_type', v)} testid="rpa-cargo-type" />
              <Field label="Km" type="number" value={form.distance_km} onChange={(v) => onChange('distance_km', v)} testid="rpa-distance-km" />
              <Field label="Nº de Eixos" type="number" value={form.axle_count} onChange={(v) => onChange('axle_count', v)} testid="rpa-axle-count" />
              <Field label="Frete de Retorno" value={form.return_freight_type} onChange={(v) => onChange('return_freight_type', v)} testid="rpa-return-freight" />
              <Field label="Km de Retorno" type="number" value={form.return_km} onChange={(v) => onChange('return_km', v)} testid="rpa-return-km" />
              <Field label="Frete Mínimo (R$)" type="number" value={form.minimum_freight} onChange={(v) => onChange('minimum_freight', v)} testid="rpa-minimum-freight" />
            </div>

            {/* DEMONSTRATIVO */}
            <div className="flex items-center justify-between">
              <SectionHeader title="Demonstrativo dos Serviços Prestados" noMargin />
              <Button variant="outline" size="sm" onClick={addService} type="button" className="h-7 text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Adicionar Serviço
              </Button>
            </div>
            <div className="space-y-2">
              {form.services.map((s, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                  <div className="col-span-8">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Descrição do Serviço</Label>
                    <Input
                      value={s.description}
                      onChange={(e) => updateService(idx, 'description', e.target.value)}
                      placeholder="Ex: 01 - COLETA E ENTREGA DE CNTR LS"
                      className="h-8 text-sm"
                      data-testid={`rpa-service-desc-${idx}`}
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Valor (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={s.value}
                      onChange={(e) => updateService(idx, 'value', e.target.value)}
                      className="h-8 text-sm text-right"
                      data-testid={`rpa-service-value-${idx}`}
                    />
                  </div>
                  <div className="col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeService(idx)}
                      className="h-8 px-2 text-red-500 hover:text-red-700"
                      disabled={form.services.length <= 1}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* DADOS DA CARGA */}
            <div className="flex items-center justify-between">
              <SectionHeader title="Dados da Carga" noMargin />
              <Button variant="outline" size="sm" onClick={addCargoItem} type="button" className="h-7 text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Adicionar Item de Carga
              </Button>
            </div>
            {form.cargo_items.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum item de carga adicionado.</p>
            ) : (
              <div className="space-y-2">
                {form.cargo_items.map((c, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                    <div className="col-span-2">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Nro NF</Label>
                      <Input value={c.nf_number} onChange={(e) => updateCargoItem(idx, 'nf_number', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Natureza</Label>
                      <Input value={c.nature} onChange={(e) => updateCargoItem(idx, 'nature', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Espécie</Label>
                      <Input value={c.species} onChange={(e) => updateCargoItem(idx, 'species', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-1">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Qtd.</Label>
                      <Input value={c.quantity} onChange={(e) => updateCargoItem(idx, 'quantity', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-1">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Kg</Label>
                      <Input type="number" value={c.weight_kg} onChange={(e) => updateCargoItem(idx, 'weight_kg', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-1">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">M³</Label>
                      <Input type="number" value={c.cubage_m3} onChange={(e) => updateCargoItem(idx, 'cubage_m3', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-1">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block">Valor</Label>
                      <Input type="number" value={c.value} onChange={(e) => updateCargoItem(idx, 'value', e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeCargoItem(idx)} className="h-8 px-2 text-red-500 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div>
              <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">Relação de Documentos</Label>
              <Input
                value={form.documents_list}
                onChange={(e) => onChange('documents_list', e.target.value)}
                placeholder="Ex: CT-e - Empresa / 2, CT-e - Empresa / 3"
                className="h-9 text-sm"
                data-testid="rpa-documents-list"
              />
            </div>

            {/* VALORES */}
            <SectionHeader title="Valores" />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Regra" value={form.rule} onChange={(v) => onChange('rule', v)} testid="rpa-rule" />
              <Field label="Tolerância" type="number" value={form.tolerance} onChange={(v) => onChange('tolerance', v)} testid="rpa-tolerance" />
              <Field label="Tarifa do Motorista (R$)" type="number" value={form.driver_fee} onChange={(v) => onChange('driver_fee', v)} testid="rpa-driver-fee" />
              <Field label="Peso de Coleta (Kg)" type="number" value={form.collection_weight} onChange={(v) => onChange('collection_weight', v)} testid="rpa-collection-weight" />
              <Field label="Frete / I. Valor do Serviço (R$)" type="number" value={form.service_value} onChange={(v) => onChange('service_value', Number(v || 0))} testid="rpa-service-value" />
              <Field label="II. Diária (R$)" type="number" value={form.daily_rate} onChange={(v) => onChange('daily_rate', Number(v || 0))} testid="rpa-daily-rate" />
              <Field label="Outros Descontos (R$)" type="number" value={form.other_discounts} onChange={(v) => onChange('other_discounts', v)} testid="rpa-other-discounts" />
              <Field label="Desconto INSS (%)" type="number" value={form.inss_discount_percent} onChange={(v) => onChange('inss_discount_percent', v)} testid="rpa-inss-percent" />
              <Field label="Desconto SEST/SENAT (%)" type="number" value={form.sest_senat_discount_percent} onChange={(v) => onChange('sest_senat_discount_percent', v)} testid="rpa-sest-senat" />
              <Field label="Base de Cálculo IR (R$)" type="number" value={form.ir_calculation_base} onChange={(v) => onChange('ir_calculation_base', v)} testid="rpa-ir-base" />
              <Field label="Desconto IRRF (R$)" type="number" value={form.irrf_discount} onChange={(v) => onChange('irrf_discount', v)} testid="rpa-irrf" />
              <Field label="Desconto de Seguro (R$)" type="number" value={form.insurance_discount} onChange={(v) => onChange('insurance_discount', v)} testid="rpa-insurance-discount" />
              <Field label="Valor de Pedágio (R$)" type="number" value={form.toll_value} onChange={(v) => onChange('toll_value', v)} testid="rpa-toll" />
              <Field label="Frete Líquido (R$)" type="number" value={form.net_freight} onChange={(v) => onChange('net_freight', v)} testid="rpa-net-freight" />
              <Field label="III. Combustível (R$)" type="number" value={form.fuel} onChange={(v) => onChange('fuel', Number(v || 0))} testid="rpa-fuel" />
              <Field label="IV. Adiantamento (R$)" type="number" value={form.advance} onChange={(v) => onChange('advance', Number(v || 0))} testid="rpa-advance" />
              <Field label="Parcelas do Adiantamento" type="number" value={form.advance_installments} onChange={(v) => onChange('advance_installments', v)} testid="rpa-advance-installments" />
              <Field label="Peso de Chegada (Kg)" type="number" value={form.arrival_weight} onChange={(v) => onChange('arrival_weight', v)} testid="rpa-arrival-weight" />
              <Field label="Desconto de Quebra de Peso (R$)" type="number" value={form.weight_loss_discount} onChange={(v) => onChange('weight_loss_discount', v)} testid="rpa-weight-loss" />
              <Field label="Saldo de Combustível (R$)" type="number" value={form.fuel_balance} onChange={(v) => onChange('fuel_balance', v)} testid="rpa-fuel-balance" />
              <Field label="Complemento (R$)" type="number" value={form.complement} onChange={(v) => onChange('complement', v)} testid="rpa-complement" />
              <Field label="Resultado (R$)" type="number" value={form.result} onChange={(v) => onChange('result', v)} testid="rpa-result" />
              <Field label="VI. Outros Acréscimos (R$)" type="number" value={form.others} onChange={(v) => onChange('others', Number(v || 0))} testid="rpa-others" />
              <Field label="Descontos (R$)" type="number" value={form.discounts} onChange={(v) => onChange('discounts', Number(v || 0))} testid="rpa-discounts" />
            </div>

            {/* SALDO A RECEBER */}
            <div className="flex items-center justify-between p-4 bg-emerald-50 border-2 border-emerald-200 rounded-lg">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                <Calculator className="w-5 h-5" />
                Saldo a Receber
              </div>
              <div className="text-xl font-bold text-emerald-700" data-testid="rpa-balance">
                {fmtMoney(calcBalance())}
              </div>
            </div>

            {/* CONTRATOS ANTERIORES */}
            <SectionHeader title="Contratos Anteriores" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Teto do INSS (R$)" type="number" value={form.inss_ceiling} onChange={(v) => onChange('inss_ceiling', v)} testid="rpa-inss-ceiling" />
              <Field label="Desconto Mensal de INSS do Contratado (R$)" type="number" value={form.contratado_monthly_inss_discount} onChange={(v) => onChange('contratado_monthly_inss_discount', v)} testid="rpa-contratado-inss" />
            </div>

            {/* DADOS DE PAGAMENTO */}
            <SectionHeader title="Dados de Pagamento" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="CIOT" value={form.ciot} onChange={(v) => onChange('ciot', v)} testid="rpa-ciot" />
            </div>

            {/* DADOS BANCÁRIOS */}
            <SectionHeader title="Dados Bancários do Beneficiário" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nº Agência" value={form.bank_agency} onChange={(v) => onChange('bank_agency', v)} testid="rpa-bank-agency" />
              <Field label="Nº Conta" value={form.bank_account} onChange={(v) => onChange('bank_account', v)} testid="rpa-bank-account" />
              <Field label="Chave PIX" value={form.bank_pix} onChange={(v) => onChange('bank_pix', v)} testid="rpa-bank-pix" />
              <Field label="Beneficiário" value={form.bank_beneficiary} onChange={(v) => onChange('bank_beneficiary', v)} testid="rpa-bank-beneficiary" />
            </div>

            {/* OBSERVAÇÃO */}
            <div>
              <Label className="text-[11px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">
                Observações / Instruções de Transporte
              </Label>
              <Textarea
                value={form.observations}
                onChange={(e) => onChange('observations', e.target.value)}
                placeholder="* Somente efetuar pagamento mediante comprovante de exportação e pesagem"
                className="text-sm min-h-[60px]"
                data-testid="rpa-observations"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="rpa-cancel-btn">
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="rpa-save-btn"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Salvando...' : editingId ? 'Atualizar Contrato' : 'Salvar Contrato'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}

function SectionHeader({ title, noMargin }) {
  return (
    <div className={noMargin ? '' : 'mt-2'}>
      <h3 className="text-[12px] font-bold uppercase tracking-wider text-emerald-700 border-b-2 border-emerald-200 pb-1">
        {title}
      </h3>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', testid, placeholder }) {
  return (
    <div>
      <Label className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">{label}</Label>
      <Input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 text-sm"
        data-testid={testid}
        placeholder={placeholder}
      />
    </div>
  );
}
