import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton, PlateTag, StatusPill } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { OptionAutocomplete } from '../components/Autocomplete';
import { todayISO } from '../lib/dates';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { toast } from 'sonner';
import { Handshake, User, Fuel, Receipt, Route, Wallet, Calculator, Plus, Trash2, Lock } from 'lucide-react';
import { BalanceText, ResultText } from './DriverSettlementsPage';

const ADVANCE_KINDS = { ADIANTAMENTO: 'Adiantamento', DEVOLUCAO: 'Devolução' };
const PAID_BY = { MOTORISTA: 'Motorista', EMPRESA: 'Empresa' };
const EXPENSE_CATEGORIES = { PEDAGIO: 'Pedágio', DIARIA: 'Diária', COMISSAO: 'Comissão do motorista', ALIMENTACAO: 'Alimentação', OUTRAS: 'Outras' };
// Acerto antigo: abastecimento sem origem/pagamento era só posto pago pelo motorista
const fuelOrigin = (f) => f.origin || 'EXTERNO';
const fuelPaidBy = (f) => f.paid_by || 'MOTORISTA';

const formatDay = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-');
const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatNumber = (value, digits = 0) => (value || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits });
// Campo digitado ("1.234,5", "120.500" ou "1234.5") -> número; vazio -> null
const parseNumber = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const brazilian = text.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(text);
  const n = Number(brazilian ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(n) ? n : NaN;
};
const newRowId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyExpense = () => ({ id: newRowId(), description: '', expense_date: '', supplier_name: '', quantity: '1', unit_value: '', category: 'OUTRAS', paid_by: 'MOTORISTA' });
const emptyAdvance = () => ({ id: newRowId(), kind: 'ADIANTAMENTO', number: '', advance_date: todayISO(), amount: '' });

// Novo acerto (/driver-settlements/new) e edição (/driver-settlements/:id/edit).
// Fechado abre só para consulta.
// Viagem acertada: vem de uma Ordem de Carregamento (OC) ou de uma Ordem de
// Serviço - Cliente (OS-C). As numerações são independentes, então a chave
// e o rótulo levam a origem.
const tripKey = (t) => (t.port_client_order_id ? `os:${t.port_client_order_id}` : `oc:${t.loading_order_id}`);
const tripLabel = (t) => `${t.port_client_order_id ? 'OS-C' : 'OC'} ${t.order_number ?? ''}`.trim();

export default function DriverSettlementFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate('/driver-settlements');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({ driver_id: '', vehicle_id: '', settlement_date: todayISO(), trip_start: '', trip_end: '', observations: '' });
  const [stored, setStored] = useState(null); // acerto como veio do servidor (cópias dos abastecimentos/viagens)
  const [candidates, setCandidates] = useState({ fuel_supplies: [], trips: [] });
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedFuel, setSelectedFuel] = useState(() => new Set());
  const [tripKm, setTripKm] = useState({}); // tripKey -> { km_start, km_end } (texto digitado)
  const [selectedTrips, setSelectedTrips] = useState(() => new Set());
  const [expenses, setExpenses] = useState([]);
  const [advances, setAdvances] = useState([]);
  const candidateSeq = useRef(0);

  const readOnly = stored?.status === 'FECHADO';

  useEffect(() => {
    api.getDrivers().then((r) => setDrivers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    // Sem per_page a lista vem só com os 20 mais novos
    api.getVehicles({ per_page: 1000 }).then((r) => setVehicles(r.data?.items || [])).catch(() => {});
    if (!isEdit) return;
    api.getDriverSettlement(id)
      .then(({ data }) => {
        setStored(data);
        setForm({
          driver_id: data.driver_id, vehicle_id: data.vehicle_id || '',
          settlement_date: data.settlement_date, observations: data.observations || '',
          trip_start: data.trip_start || '', trip_end: data.trip_end || '',
        });
        setSelectedFuel(new Set((data.fuel_supplies || []).map((f) => f.id)));
        setSelectedTrips(new Set((data.trips || []).map(tripKey)));
        setTripKm(Object.fromEntries((data.trips || []).map((t) => [tripKey(t), {
          km_start: t.km_start ?? '', km_end: t.km_end ?? '',
        }])));
        setExpenses((data.expenses || []).map((e) => ({
          ...e, expense_date: e.expense_date || '', supplier_name: e.supplier_name || '',
          quantity: String(e.quantity ?? 1), unit_value: String(e.unit_value ?? ''),
          category: e.category || 'OUTRAS', paid_by: e.paid_by || 'MOTORISTA',
        })));
        setAdvances((data.advances || []).map((a) => ({ ...a, number: a.number || '', advance_date: a.advance_date || '', amount: String(a.amount) })));
      })
      .catch((error) => {
        toast.error(apiErrorMessage(error, 'Erro ao carregar o acerto'));
        backToList();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Abastecimentos pagos pelo motorista e viagens aprovadas dele ainda não acertados
  useEffect(() => {
    if (!form.driver_id || readOnly || loading) {
      setCandidates({ fuel_supplies: [], trips: [] });
      return;
    }
    const seq = ++candidateSeq.current;
    setLoadingCandidates(true);
    const params = { driver_id: form.driver_id };
    if (form.vehicle_id) params.vehicle_id = form.vehicle_id;
    if (form.trip_start) params.date_from = form.trip_start;
    if (form.trip_end) params.date_to = form.trip_end;
    if (isEdit) params.settlement_id = id;
    api.getDriverSettlementCandidates(params)
      .then(({ data }) => {
        if (seq !== candidateSeq.current) return;
        setCandidates(data);
        // Acerto novo: os abastecimentos da viagem já vêm marcados (desmarque o que não for dela)
        if (!isEdit) setSelectedFuel(new Set(data.fuel_supplies.map((f) => f.id)));
      })
      .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao buscar abastecimentos e viagens')))
      .finally(() => { if (seq === candidateSeq.current) setLoadingCandidates(false); });
  }, [form.driver_id, form.vehicle_id, form.trip_start, form.trip_end, readOnly, loading, isEdit, id]);

  // Linhas mostradas: as já gravadas no acerto + as disponíveis
  const fuelRows = useMemo(() => {
    const byId = new Map((stored?.fuel_supplies || []).filter((f) => selectedFuel.has(f.id)).map((f) => [f.id, f]));
    candidates.fuel_supplies.forEach((f) => byId.set(f.id, f));
    return [...byId.values()].sort((a, b) => (b.supply_date || '').localeCompare(a.supply_date || ''));
  }, [stored, candidates, selectedFuel]);
  const tripRows = useMemo(() => {
    const byId = new Map((stored?.trips || []).filter((t) => selectedTrips.has(tripKey(t))).map((t) => [tripKey(t), t]));
    candidates.trips.forEach((t) => byId.set(tripKey(t), t));
    return [...byId.values()].sort((a, b) => (b.order_date || '').localeCompare(a.order_date || '') || (b.order_number || 0) - (a.order_number || 0));
  }, [stored, candidates, selectedTrips]);

  const tripKmValue = (orderId) => {
    const km = tripKm[orderId] || {};
    const start = parseNumber(km.km_start);
    const end = parseNumber(km.km_end);
    return start !== null && end !== null && !Number.isNaN(start) && !Number.isNaN(end) && end >= start ? end - start : null;
  };

  // Mesma conta do backend (routers/driver_settlements.py, _totals)
  const totals = useMemo(() => {
    const round2 = (v) => Math.round(v * 100) / 100;
    const fuel = fuelRows.filter((f) => selectedFuel.has(f.id));
    const fuelTotal = fuel.reduce((s, f) => s + (f.total || 0), 0);
    const fuelInternal = fuel.filter((f) => fuelOrigin(f) === 'INTERNO').reduce((s, f) => s + (f.total || 0), 0);
    const fuelDriver = fuel.filter((f) => fuelPaidBy(f) === 'MOTORISTA').reduce((s, f) => s + (f.total || 0), 0);
    const liters = fuel.reduce((s, f) => s + (f.liters || 0), 0);
    const expenseValue = (e) => (parseNumber(e.quantity) || 0) * (parseNumber(e.unit_value) || 0);
    const expensesTotal = expenses.reduce((s, e) => s + expenseValue(e), 0);
    const expensesDriver = expenses.filter((e) => e.paid_by === 'MOTORISTA').reduce((s, e) => s + expenseValue(e), 0);
    const sumKind = (kind) => advances.filter((a) => a.kind === kind).reduce((s, a) => s + (parseNumber(a.amount) || 0), 0);
    const advancesTotal = sumKind('ADIANTAMENTO');
    const returnsTotal = sumKind('DEVOLUCAO');
    const km = [...selectedTrips].reduce((s, tripId) => s + (tripKmValue(tripId) || 0), 0);
    const revenue = tripRows.filter((t) => selectedTrips.has(tripKey(t))).reduce((s, t) => s + (t.freight_value || 0), 0);
    const costTotal = fuelTotal + expensesTotal;
    const result = round2(revenue - costTotal);
    return {
      fuelTotal, fuelInternal, fuelExternal: fuelTotal - fuelInternal, fuelDriver, liters, expensesTotal, expensesDriver,
      advancesTotal, returnsTotal, km, revenue, costTotal, result,
      margin: revenue ? Math.round((result / revenue) * 1000) / 10 : null,
      kmPerLiter: km && liters ? km / liters : null,
      // Saldo com o motorista: só o que ELE pagou
      balance: round2(fuelDriver + expensesDriver - advancesTotal + returnsTotal),
      withoutCost: fuel.filter((f) => !f.total).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuelRows, selectedFuel, expenses, advances, selectedTrips, tripKm, tripRows]);

  // Trocar o motorista ou o veículo troca a lista: o que estava marcado era do anterior
  const changeLink = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSelectedFuel(new Set());
    setSelectedTrips(new Set());
  };
  const toggleIn = (setter) => (key) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleFuel = toggleIn(setSelectedFuel);
  const toggleTrip = toggleIn(setSelectedTrips);
  const setKm = (orderId, field, value) => setTripKm((prev) => ({ ...prev, [orderId]: { ...prev[orderId], [field]: value } }));
  const updateRow = (setter) => (rowId, field, value) => setter((prev) => prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)));
  const updateExpense = updateRow(setExpenses);
  const updateAdvance = updateRow(setAdvances);

  const handleSubmit = async () => {
    if (!form.driver_id || !form.settlement_date) {
      toast.error('Escolha o motorista e a data do acerto');
      return;
    }
    if (form.trip_start && form.trip_end && form.trip_end < form.trip_start) {
      toast.error('A chegada da viagem é antes da saída');
      return;
    }
    const trips = [];
    for (const key of selectedTrips) {
      const row = tripRows.find((t) => tripKey(t) === key);
      if (!row) continue;
      const km = tripKm[key] || {};
      const kmStart = parseNumber(km.km_start);
      const kmEnd = parseNumber(km.km_end);
      if (Number.isNaN(kmStart) || Number.isNaN(kmEnd) || (kmStart !== null && kmEnd !== null && kmEnd < kmStart)) {
        toast.error(`Ordem ${tripLabel(row)}: confira o km inicial e o final`);
        return;
      }
      trips.push(row.port_client_order_id
        ? { port_client_order_id: row.port_client_order_id, km_start: kmStart, km_end: kmEnd }
        : { loading_order_id: row.loading_order_id, km_start: kmStart, km_end: kmEnd });
    }
    const expensePayload = [];
    for (const e of expenses) {
      const quantity = parseNumber(e.quantity) ?? 1;
      const unitValue = parseNumber(e.unit_value) ?? 0;
      if (!e.description.trim() || Number.isNaN(quantity) || quantity <= 0 || Number.isNaN(unitValue) || unitValue < 0) {
        toast.error('Confira as despesas: descrição, quantidade e valor');
        return;
      }
      expensePayload.push({ id: e.id, description: e.description, expense_date: e.expense_date || null, supplier_name: e.supplier_name || null, quantity, unit_value: unitValue, category: e.category || 'OUTRAS', paid_by: e.paid_by || 'MOTORISTA' });
    }
    const advancePayload = [];
    for (const a of advances) {
      const amount = parseNumber(a.amount);
      if (!amount || Number.isNaN(amount) || amount <= 0) {
        toast.error('Informe o valor de cada adiantamento/devolução');
        return;
      }
      advancePayload.push({ id: a.id, kind: a.kind, number: a.number || null, advance_date: a.advance_date || null, amount });
    }
    const payload = {
      driver_id: form.driver_id, vehicle_id: form.vehicle_id || null,
      settlement_date: form.settlement_date, observations: form.observations || null,
      trip_start: form.trip_start || null, trip_end: form.trip_end || null,
      fuel_supply_ids: [...selectedFuel], trips, expenses: expensePayload, advances: advancePayload,
    };
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateDriverSettlement(id, payload);
        toast.success('Acerto atualizado');
      } else {
        const { data } = await api.createDriverSettlement(payload);
        toast.success(`Acerto nº ${data.settlement_number} registrado`);
      }
      backToList();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar o acerto'));
    } finally {
      setSaving(false);
    }
  };

  const noDriverHint = (
    <p className="text-sm text-slate-500 dark:text-slate-400">Escolha o motorista para ver o que ainda não foi acertado.</p>
  );
  const smallInput = 'h-8 text-sm';

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4" data-testid="driver-settlement-form-page">
        <PageHeader
          backTo={backToList}
          icon={Handshake}
          title={isEdit ? `Acerto da Viagem nº ${stored?.settlement_number ?? ''}` : 'Novo acerto da viagem'}
          subtitle="Prestação de contas da viagem: saldo com o motorista e resultado (lucro ou prejuízo)"
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            {readOnly && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="settlement-closed-banner">
                <Lock className="w-4 h-4 shrink-0" />
                Acerto fechado em {formatDay(stored.closed_at)} por {stored.closed_by_name}. Para alterar, reabra pela lista.
              </div>
            )}

            <FormSection title="Acerto" icon={User}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Motorista" required className="lg:col-span-2">
                  {readOnly ? <Input value={stored.driver_name} disabled /> : (
                    <OptionAutocomplete value={form.driver_id} onChange={(v) => changeLink('driver_id', v)} options={drivers.map((d) => [d.id, d.name])} testId="settlement-driver" />
                  )}
                </Field>
                <Field label="Veículo" hint="Com veículo, puxa todos os abastecimentos dele (inclusive tanque próprio).">
                  {readOnly ? <Input value={stored.vehicle_plate || '-'} disabled /> : (
                    <OptionAutocomplete
                      value={form.vehicle_id}
                      onChange={(v) => changeLink('vehicle_id', v)}
                      options={vehicles.map((v) => [v.id, [v.plate, v.model].filter(Boolean).join(' · ')])}
                      testId="settlement-vehicle"
                    />
                  )}
                </Field>
                <Field label="Data do acerto" required>
                  <Input type="date" value={form.settlement_date} onChange={(e) => setForm((p) => ({ ...p, settlement_date: e.target.value }))} disabled={readOnly} data-testid="settlement-date" />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Saída da viagem" hint="Filtra os abastecimentos pelo período da viagem.">
                  <Input type="date" value={form.trip_start} onChange={(e) => setForm((p) => ({ ...p, trip_start: e.target.value }))} disabled={readOnly} data-testid="settlement-trip-start" />
                </Field>
                <Field label="Chegada da viagem">
                  <Input type="date" value={form.trip_end} onChange={(e) => setForm((p) => ({ ...p, trip_end: e.target.value }))} disabled={readOnly} data-testid="settlement-trip-end" />
                </Field>
              </div>
              <Field label="Observações">
                <Textarea rows={2} value={form.observations} onChange={(e) => setForm((p) => ({ ...p, observations: e.target.value }))} disabled={readOnly} data-testid="settlement-observations" />
              </Field>
            </FormSection>

            <FormSection title={`Abastecimento (${selectedFuel.size})`} icon={Fuel} contentClassName="p-0">
              {!form.driver_id ? <div className="p-4">{noDriverHint}</div> : fuelRows.length === 0 ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
                  {loadingCandidates ? 'Carregando...' : 'Nenhum abastecimento em aberto para este motorista/veículo no período.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <p className="px-4 pt-3 text-xs text-slate-500 dark:text-slate-400">
                    Interno = tanque próprio (custo do litro registrado no lançamento). Todos entram no resultado da viagem; só os pagos pelo motorista entram no saldo com ele.
                  </p>
                  <table className="data-table" data-testid="settlement-fuel-table">
                    <thead>
                      <tr>
                        <th className="w-10 pr-0" />
                        <th>Data</th><th>Local/Posto</th><th>Origem</th><th>Pagamento</th>
                        <th className="!text-right">Litros</th><th className="!text-right">R$/Litro</th><th className="!text-right">Total</th>
                        <th className="hidden lg:table-cell !text-right">Km hodômetro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fuelRows.map((f) => {
                        const internal = fuelOrigin(f) === 'INTERNO';
                        const unit = f.unit_price || (f.liters ? f.total / f.liters : 0);
                        return (
                          <tr key={f.id} onClick={() => !readOnly && toggleFuel(f.id)} data-selected={selectedFuel.has(f.id)} className={readOnly ? '' : 'cursor-pointer'}>
                            <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                              <Checkbox checked={selectedFuel.has(f.id)} onCheckedChange={() => toggleFuel(f.id)} disabled={readOnly} aria-label={`Acertar abastecimento ${f.supply_number}`} data-testid={`fuel-check-${f.supply_number}`} />
                            </td>
                            <td className="tabular-nums whitespace-nowrap">{formatDay(f.supply_date)}</td>
                            <td><div className="max-w-[12.5rem] truncate" title={`Nº ${f.supply_number}`}>{internal ? 'Tanque próprio' : (f.supplier_name || '-')}</div></td>
                            <td><StatusPill tone={internal ? 'primary' : 'slate'} dot={false}>{internal ? 'Interno' : 'Externo'}</StatusPill></td>
                            <td><StatusPill tone={fuelPaidBy(f) === 'MOTORISTA' ? 'amber' : 'blue'} dot={false}>{PAID_BY[fuelPaidBy(f)]}</StatusPill></td>
                            <td className="text-right tabular-nums">{formatNumber(f.liters, 2)}</td>
                            <td className="text-right tabular-nums whitespace-nowrap">{unit ? formatMoney(unit) : '-'}</td>
                            <td className="text-right tabular-nums whitespace-nowrap">
                              {f.total ? formatMoney(f.total) : <span className="text-amber-600" title="Abastecimento sem custo registrado: corrija o lançamento">sem custo</span>}
                            </td>
                            <td className="hidden lg:table-cell text-right tabular-nums">{f.reading != null ? formatNumber(f.reading) : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </FormSection>

            <FormSection
              title={`Despesas (${expenses.length})`}
              icon={Receipt}
              contentClassName="p-0"
              actions={!readOnly && (
                <Button type="button" size="sm" variant="outline" onClick={() => setExpenses((p) => [...p, emptyExpense()])} data-testid="add-expense-btn">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar despesa
                </Button>
              )}
            >
              {expenses.length === 0 ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Pedágio, diária, comissão do motorista, alimentação... Informe quem pagou: só o que o motorista pagou entra no saldo com ele.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Descrição</th><th className="w-40">Categoria</th><th className="w-32">Pago por</th><th>Data</th><th>Fornecedor</th><th className="w-24">Quant.</th><th className="w-32">Unitário (R$)</th><th className="!text-right">Total</th><th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.map((e, index) => (
                        <tr key={e.id}>
                          <td className="min-w-[11.25rem]"><Input className={smallInput} value={e.description} onChange={(ev) => updateExpense(e.id, 'description', ev.target.value)} disabled={readOnly} aria-label={`Descrição da despesa ${index + 1}`} data-testid={`expense-description-${index}`} /></td>
                          <td>
                            <Select value={e.category} onValueChange={(v) => updateExpense(e.id, 'category', v)} disabled={readOnly}>
                              <SelectTrigger className={smallInput} aria-label={`Categoria da despesa ${index + 1}`} data-testid={`expense-category-${index}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(EXPENSE_CATEGORIES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Select value={e.paid_by} onValueChange={(v) => updateExpense(e.id, 'paid_by', v)} disabled={readOnly}>
                              <SelectTrigger className={smallInput} aria-label={`Quem pagou a despesa ${index + 1}`} data-testid={`expense-paid-by-${index}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(PAID_BY).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td><Input type="date" className={smallInput} value={e.expense_date} onChange={(ev) => updateExpense(e.id, 'expense_date', ev.target.value)} disabled={readOnly} aria-label={`Data da despesa ${index + 1}`} /></td>
                          <td className="min-w-[8.75rem]"><Input className={smallInput} value={e.supplier_name} onChange={(ev) => updateExpense(e.id, 'supplier_name', ev.target.value)} disabled={readOnly} aria-label={`Fornecedor da despesa ${index + 1}`} /></td>
                          <td><Input inputMode="decimal" className={smallInput} value={e.quantity} onChange={(ev) => updateExpense(e.id, 'quantity', ev.target.value)} disabled={readOnly} aria-label={`Quantidade da despesa ${index + 1}`} /></td>
                          <td><Input inputMode="decimal" className={smallInput} value={e.unit_value} onChange={(ev) => updateExpense(e.id, 'unit_value', ev.target.value)} disabled={readOnly} aria-label={`Valor unitário da despesa ${index + 1}`} data-testid={`expense-value-${index}`} /></td>
                          <td className="text-right tabular-nums whitespace-nowrap">{formatMoney((parseNumber(e.quantity) || 0) * (parseNumber(e.unit_value) || 0))}</td>
                          <td>
                            {!readOnly && (
                              <Button type="button" variant="ghost" size="icon" onClick={() => setExpenses((p) => p.filter((r) => r.id !== e.id))} aria-label={`Remover despesa ${index + 1}`} title="Remover despesa">
                                <Trash2 className="w-4 h-4 text-red-600" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </FormSection>

            <FormSection title={`Viagens acertadas (${selectedTrips.size})`} icon={Route} contentClassName="p-0">
              {!form.driver_id ? <div className="p-4">{noDriverHint}</div> : tripRows.length === 0 ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
                  {loadingCandidates ? 'Carregando...' : 'Nenhuma viagem em aberto para este motorista (Ordem de Carregamento aprovada ou Ordem de Serviço - Cliente em trânsito/concluída).'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <p className="px-4 pt-3 text-xs text-slate-500 dark:text-slate-400">Marque as viagens que serão acertadas e informe o km do hodômetro na saída e na chegada. OC = Ordem de Carregamento · OS-C = Ordem de Serviço - Cliente.</p>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-10 pr-0" />
                        <th>Ordem</th><th>Data</th><th className="hidden md:table-cell">Booking</th><th className="hidden lg:table-cell">Rota</th>
                        <th className="hidden md:table-cell">Placa</th><th className="w-32">Km inicial</th><th className="w-32">Km final</th><th className="!text-right">Km</th><th className="!text-right">Frete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tripRows.map((t) => {
                        const key = tripKey(t);
                        const checked = selectedTrips.has(key);
                        const km = tripKm[key] || {};
                        const distance = tripKmValue(key);
                        const testSuffix = t.port_client_order_id ? `os-${t.order_number}` : t.order_number;
                        return (
                          <tr key={key} data-selected={checked}>
                            <td className="pr-0">
                              <Checkbox checked={checked} onCheckedChange={() => toggleTrip(key)} disabled={readOnly} aria-label={`Acertar viagem da ordem ${tripLabel(t)}`} data-testid={`trip-check-${testSuffix}`} />
                            </td>
                            <td className="cell-strong tabular-nums whitespace-nowrap" title={t.port_client_order_id ? 'Ordem de Serviço - Cliente' : 'Ordem de Carregamento'}>{tripLabel(t)}</td>
                            <td className="tabular-nums whitespace-nowrap">{formatDay(t.order_date)}</td>
                            <td className="hidden md:table-cell">{t.booking || '-'}</td>
                            <td className="hidden lg:table-cell"><div className="max-w-[13.75rem] truncate">{t.route_name || t.client_name || '-'}</div></td>
                            <td className="hidden md:table-cell">{t.truck_plate ? <PlateTag>{t.truck_plate}</PlateTag> : '-'}</td>
                            <td><Input inputMode="decimal" className={smallInput} value={km.km_start ?? ''} onChange={(e) => setKm(key, 'km_start', e.target.value)} disabled={readOnly || !checked} aria-label={`Km inicial da ordem ${tripLabel(t)}`} /></td>
                            <td><Input inputMode="decimal" className={smallInput} value={km.km_end ?? ''} onChange={(e) => setKm(key, 'km_end', e.target.value)} disabled={readOnly || !checked} aria-label={`Km final da ordem ${tripLabel(t)}`} /></td>
                            <td className="text-right tabular-nums">{checked && distance != null ? formatNumber(distance, 1) : '-'}</td>
                            <td className="text-right tabular-nums whitespace-nowrap">{formatMoney(t.freight_value)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </FormSection>

            <FormSection
              title={`Adiantamentos e devoluções (${advances.length})`}
              icon={Wallet}
              contentClassName="p-0"
              actions={!readOnly && (
                <Button type="button" size="sm" variant="outline" onClick={() => setAdvances((p) => [...p, emptyAdvance()])} data-testid="add-advance-btn">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar
                </Button>
              )}
            >
              {advances.length === 0 ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Adiantamento: dinheiro que a empresa deu ao motorista para a viagem. Devolução: o que ele devolveu.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr><th className="w-44">Tipo</th><th>Número</th><th>Data</th><th className="w-40">Valor (R$)</th><th className="w-10" /></tr>
                    </thead>
                    <tbody>
                      {advances.map((a, index) => (
                        <tr key={a.id}>
                          <td>
                            <Select value={a.kind} onValueChange={(v) => updateAdvance(a.id, 'kind', v)} disabled={readOnly}>
                              <SelectTrigger className={smallInput} aria-label={`Tipo do lançamento ${index + 1}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Object.entries(ADVANCE_KINDS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td><Input className={smallInput} value={a.number} onChange={(e) => updateAdvance(a.id, 'number', e.target.value)} disabled={readOnly} aria-label={`Número do lançamento ${index + 1}`} /></td>
                          <td><Input type="date" className={smallInput} value={a.advance_date} onChange={(e) => updateAdvance(a.id, 'advance_date', e.target.value)} disabled={readOnly} aria-label={`Data do lançamento ${index + 1}`} /></td>
                          <td><Input inputMode="decimal" className={smallInput} value={a.amount} onChange={(e) => updateAdvance(a.id, 'amount', e.target.value)} disabled={readOnly} aria-label={`Valor do lançamento ${index + 1}`} data-testid={`advance-amount-${index}`} /></td>
                          <td>
                            {!readOnly && (
                              <Button type="button" variant="ghost" size="icon" onClick={() => setAdvances((p) => p.filter((r) => r.id !== a.id))} aria-label={`Remover lançamento ${index + 1}`} title="Remover">
                                <Trash2 className="w-4 h-4 text-red-600" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </FormSection>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <FormSection title="Saldo com o motorista" icon={Wallet}>
                <dl className="space-y-1.5 text-sm tabular-nums" data-testid="settlement-balance-box">
                  {[
                    ['Abastecimentos pagos pelo motorista', formatMoney(totals.fuelDriver)],
                    ['Despesas pagas pelo motorista', formatMoney(totals.expensesDriver)],
                    ['(-) Adiantamentos entregues', `- ${formatMoney(totals.advancesTotal)}`],
                    ['(+) Devoluções do motorista', formatMoney(totals.returnsTotal)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">{label}</dt><dd>{value}</dd></div>
                  ))}
                  <div className="flex justify-between gap-3 border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
                    <dt className="font-medium text-slate-700 dark:text-slate-200">
                      {totals.balance > 0 ? 'A pagar ao motorista' : totals.balance < 0 ? 'A devolver pelo motorista' : 'Saldo zerado'}
                    </dt>
                    <dd className="text-base" data-testid="settlement-balance"><BalanceText value={totals.balance} /></dd>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Abastecimento interno e o que a empresa pagou não entram neste saldo.</p>
                </dl>
              </FormSection>

              <FormSection title="Resultado da viagem" icon={Calculator}>
                <dl className="space-y-1.5 text-sm tabular-nums" data-testid="settlement-result-box">
                  {[
                    ['Receita (frete das viagens)', formatMoney(totals.revenue)],
                    ['(-) Abastecimento interno', `- ${formatMoney(totals.fuelInternal)}`],
                    ['(-) Abastecimento externo', `- ${formatMoney(totals.fuelExternal)}`],
                    ['(-) Despesas', `- ${formatMoney(totals.expensesTotal)}`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">{label}</dt><dd>{value}</dd></div>
                  ))}
                  <div className="flex justify-between gap-3 border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
                    <dt className={`font-medium ${totals.result > 0 ? 'text-emerald-700 dark:text-emerald-400' : totals.result < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>
                      {totals.result > 0 ? 'Lucro' : totals.result < 0 ? 'Prejuízo' : 'Resultado'}
                    </dt>
                    <dd className="text-base" data-testid="settlement-result"><ResultText value={totals.result} margin={totals.margin} /></dd>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Km rodado: {formatNumber(totals.km, 1)}{totals.kmPerLiter ? ` · média ${formatNumber(totals.kmPerLiter, 2)} km/L` : ''} · {formatNumber(totals.liters, 2)} L.
                    {' '}Adiantamento não é custo.
                    {totals.withoutCost > 0 && <span className="text-amber-600"> {totals.withoutCost} abastecimento(s) sem custo registrado.</span>}
                  </p>
                </dl>
              </FormSection>
            </div>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>{readOnly ? 'Voltar' : 'Cancelar'}</Button>
              {!readOnly && (
                <Button type="button" onClick={handleSubmit} disabled={saving} data-testid="settlement-save-btn">
                  {saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : 'Registrar acerto')}
                </Button>
              )}
            </FormActions>
          </div>
        )}
      </div>
    </Layout>
  );
}
