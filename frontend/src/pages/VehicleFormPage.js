import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Autocomplete, OptionAutocomplete } from '../components/Autocomplete';
import {
  DocumentImportButton, DocumentImportNotice, DocumentAttachments, applyDocumentFields, addAttachment, IMPORTED_FIELD_CLASS,
} from '../components/DocumentImport';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Car, IdCard, Gauge, FileCheck2, Link2 } from 'lucide-react';
import { formatPlate } from '../lib/masks';
import { apiErrorMessage } from '../lib/errors';

const VEHICLE_TYPES = [
  ['CAMINHÃO', 'Caminhão'],
  ['CARRETA', 'Carreta'],
  ['CAVALO', 'Cavalo Mecânico'],
  ['EMPILHADEIRA', 'Empilhadeira'],
  ['GUINDASTE', 'Guindaste'],
  ['REACH_STACKER', 'Reach Stacker'],
  ['VAN', 'Van'],
  ['EQUIPAMENTO', 'Outro Equipamento'],
];
const STATUS_OPTIONS = [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo'], ['MANUTENCAO', 'Em Manutenção']];
const CATEGORY_OPTIONS = [['CARGA', 'Carga'], ['TRACAO', 'Tração'], ['EQUIPAMENTO_PATIO', 'Equipamento de Pátio']];
const FUEL_OPTIONS = [['DIESEL', 'Diesel'], ['GASOLINA', 'Gasolina'], ['ELETRICO', 'Elétrico'], ['GLP', 'GLP']];
const OWNER_TYPE_OPTIONS = [['PROPRIA', 'Empresa Própria'], ['TERCEIRIZADO', 'Terceirizado'], ['AUTONOMO', 'Motorista Autônomo']];
const OWNERSHIP_STATUS_OPTIONS = [['PROPRIO', 'Próprio'], ['ALUGADO', 'Alugado'], ['AGREGADO', 'Agregado']];

const buildEmptyVehicleForm = () => ({
  plate: '', renavam: '', chassis: '', model: '', brand: '', year: '', model_year: '', color: '', asset_code: '',
  vehicle_type: '', category: '', load_capacity: '', axle_count: '', body_type: '', fuel_type: '', tank_capacity: '',
  fuel_target_km_l: '', engine_power: '', tare_weight: '', gross_weight: '',
  crlv_number: '', crlv_expiry: '', licensing_expiry: '', tachograph_expiry: '', inspection_date: '', inspection_expiry: '', insurance_expiry: '',
  owner_type: '', ownership_status: '', transport_company: '', status: 'ATIVO', observations: '', driver_id: '',
  in_maintenance_plan: false,
  document_attachments: [],
});

// Novo veículo (/fleet/veiculos/new) e edição (/fleet/veiculos/:id/edit)
export default function VehicleFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate('/fleet');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(buildEmptyVehicleForm());
  const [importedFields, setImportedFields] = useState(() => new Set());
  const [importNotice, setImportNotice] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [transportCompanies, setTransportCompanies] = useState([]);

  useEffect(() => {
    api.getDrivers()
      .then((r) => setDrivers(Array.isArray(r.data) ? r.data : []))
      .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar motoristas')));
    api.getCompanies()
      .then((r) => setTransportCompanies(r.data?.items || r.data || []))
      .catch(() => {});

    if (!isEdit) return;
    api.getVehicle(id)
      .then(({ data: vehicle }) => {
        // Texto nos campos de texto (o servidor manda ano e eixos como número)
        const empty = buildEmptyVehicleForm();
        const loaded = { ...empty };
        for (const key of Object.keys(empty)) {
          if (vehicle[key] !== undefined && vehicle[key] !== null) {
            loaded[key] = typeof empty[key] === 'string' && typeof vehicle[key] !== 'string' ? String(vehicle[key]) : vehicle[key];
          }
        }
        setForm(loaded);
      })
      .catch((error) => {
        toast.error(apiErrorMessage(error, 'Erro ao carregar veículo'));
        backToList();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setImportedFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  // Campos lidos do CRLV vão para o formulário, destacados para conferência.
  // Tipo e Categoria são deduzidos da Espécie/Tipo do documento, então só
  // entram se ainda estiverem vazios.
  const handleCrlvRead = (reading) => {
    const warnings = [...reading.warnings];
    const readPlate = reading.fields.plate;
    if (isEdit && readPlate && form.plate && readPlate !== form.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase()) {
      warnings.unshift(`A placa do documento (${readPlate}) é diferente da placa deste cadastro: confira se é o veículo certo`);
    }
    const { next, applied } = applyDocumentFields(form, reading.fields, { onlyIfEmpty: ['vehicle_type', 'category'] });
    next.document_attachments = addAttachment(next.document_attachments, reading.file_url);
    const info = [];
    if (reading.info.licensing_year) info.push(['Exercício do licenciamento', reading.info.licensing_year]);
    if (reading.info.owner_name) {
      info.push(['Proprietário', [reading.info.owner_name, reading.info.owner_document].filter(Boolean).join(' - ')]);
    }
    setForm(next);
    setImportedFields(new Set(applied));
    setImportNotice({ label: 'CRLV', count: applied.length, warnings, info });
  };
  const imported = (field) => (importedFields.has(field) ? IMPORTED_FIELD_CLASS : '');

  const handleSubmit = async () => {
    if (!form.plate || !form.vehicle_type) {
      toast.error('Preencha os campos obrigatórios (Placa e Tipo)');
      return;
    }
    setSaving(true);
    try {
      const targetKmL = Number(String(form.fuel_target_km_l).replace(',', '.'));
      const data = {
        plate: form.plate.toUpperCase(),
        renavam: form.renavam || null,
        chassis: form.chassis || null,
        model: form.model || null,
        brand: form.brand || null,
        year: form.year ? parseInt(form.year) : null,
        model_year: form.model_year ? parseInt(form.model_year) : null,
        color: form.color || null,
        asset_code: form.asset_code || null,
        vehicle_type: form.vehicle_type,
        category: form.category || null,
        load_capacity: form.load_capacity || null,
        axle_count: form.axle_count ? parseInt(form.axle_count) : null,
        body_type: form.body_type || null,
        fuel_type: form.fuel_type || null,
        tank_capacity: form.tank_capacity || null,
        fuel_target_km_l: targetKmL > 0 ? targetKmL : null,
        engine_power: form.engine_power || null,
        tare_weight: form.tare_weight || null,
        gross_weight: form.gross_weight || null,
        crlv_number: form.crlv_number || null,
        crlv_expiry: form.crlv_expiry || null,
        licensing_expiry: form.licensing_expiry || null,
        tachograph_expiry: form.tachograph_expiry || null,
        inspection_date: form.inspection_date || null,
        inspection_expiry: form.inspection_expiry || null,
        insurance_expiry: form.insurance_expiry || null,
        owner_type: form.owner_type || null,
        in_maintenance_plan: !!form.in_maintenance_plan,
        ownership_status: form.ownership_status || null,
        transport_company: form.transport_company || null,
        status: form.status,
        observations: form.observations || null,
        driver_id: form.driver_id || null,
        document_attachments: form.document_attachments || [],
      };
      if (isEdit) {
        if (!form.driver_id) data.clear_driver = true;
        await api.updateVehicle(id, data);
        toast.success('Veículo atualizado com sucesso!');
      } else {
        await api.createVehicle(data);
        toast.success('Veículo cadastrado com sucesso!');
      }
      backToList();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar veículo'));
    } finally {
      setSaving(false);
    }
  };

  // Campo de texto ligado a form[name], com o destaque de "lido do CRLV"
  const T = ({ name, label, type = 'text', required, className, transform, inputMode, testId }) => (
    <Field label={label} required={required} className={className}>
      <Input
        type={type}
        inputMode={inputMode}
        min={type === 'number' ? '0' : undefined}
        className={imported(name)}
        value={form[name] ?? ''}
        onChange={(e) => onChange(name, transform ? transform(e.target.value) : e.target.value)}
        data-testid={testId}
      />
    </Field>
  );
  const S = ({ name, label, options, required, className }) => (
    <Field label={label} required={required} className={className}>
      <Select value={form[name]} onValueChange={(value) => onChange(name, value)}>
        <SelectTrigger className={imported(name)} data-testid={`vehicle-${name.replace(/_/g, '-')}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="vehicle-form-page">
        <PageHeader
          backTo={backToList}
          icon={Car}
          title={isEdit ? 'Editar veículo' : 'Novo veículo'}
          subtitle={isEdit && form.plate ? `Placa ${form.plate}` : 'Cadastro de veículo e equipamento da frota'}
          actions={<DocumentImportButton kinds={['crlv']} onRead={handleCrlvRead} disabled={saving || loading} />}
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <DocumentImportNotice notice={importNotice} onClose={() => setImportNotice(null)} />

            <FormSection title="Identificação" icon={IdCard}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {T({ name: 'plate', label: 'Placa', required: true, transform: formatPlate, testId: 'input-vehicle-plate-form' })}
                {S({ name: 'vehicle_type', label: 'Tipo', options: VEHICLE_TYPES, required: true })}
                {S({ name: 'category', label: 'Categoria', options: CATEGORY_OPTIONS })}
                {S({ name: 'status', label: 'Status', options: STATUS_OPTIONS })}
                {T({ name: 'brand', label: 'Marca' })}
                {T({ name: 'model', label: 'Modelo' })}
                {T({ name: 'year', label: 'Ano de fabricação', type: 'number' })}
                {T({ name: 'model_year', label: 'Ano modelo', type: 'number' })}
                {T({ name: 'color', label: 'Cor' })}
                {T({ name: 'asset_code', label: 'Nº patrimônio / cód. interno' })}
              </div>
            </FormSection>

            <FormSection title="Especificações" icon={Gauge}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {T({ name: 'load_capacity', label: 'Capacidade de carga' })}
                {T({ name: 'axle_count', label: 'Nº de eixos', type: 'number' })}
                {T({ name: 'body_type', label: 'Tipo de carroceria / implemento', className: 'col-span-2' })}
                {S({ name: 'fuel_type', label: 'Combustível', options: FUEL_OPTIONS })}
                {T({ name: 'tank_capacity', label: 'Capacidade do tanque' })}
                {T({ name: 'fuel_target_km_l', label: 'Meta de consumo (km/L)', inputMode: 'decimal' })}
                {T({ name: 'engine_power', label: 'Potência do motor' })}
                {T({ name: 'tare_weight', label: 'Tara (peso vazio)' })}
                {T({ name: 'gross_weight', label: 'PBT (peso bruto total)' })}
              </div>
            </FormSection>

            <FormSection title="Documentação" icon={FileCheck2}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {T({ name: 'renavam', label: 'RENAVAM' })}
                {T({ name: 'chassis', label: 'Chassi' })}
                {T({ name: 'crlv_number', label: 'Número do CRLV' })}
                {T({ name: 'crlv_expiry', label: 'Validade do CRLV', type: 'date' })}
                {T({ name: 'licensing_expiry', label: 'Vencimento do licenciamento', type: 'date' })}
                {T({ name: 'tachograph_expiry', label: 'Vencimento do tacógrafo', type: 'date' })}
                {T({ name: 'inspection_date', label: 'Data da vistoria', type: 'date' })}
                {T({ name: 'inspection_expiry', label: 'Validade da vistoria', type: 'date' })}
                {T({ name: 'insurance_expiry', label: 'Vencimento do seguro', type: 'date' })}
              </div>
              <Field label="Documentos anexados (CRLV...)">
                <DocumentAttachments value={form.document_attachments} onChange={(v) => onChange('document_attachments', v)} />
              </Field>
            </FormSection>

            <FormSection title="Vínculo" icon={Link2}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {S({ name: 'owner_type', label: 'Proprietário', options: OWNER_TYPE_OPTIONS })}
                {S({ name: 'ownership_status', label: 'Status de propriedade', options: OWNERSHIP_STATUS_OPTIONS })}
                <Field label="Transportadora vinculada">
                  <Autocomplete
                    value={form.transport_company}
                    onChange={(v) => onChange('transport_company', v)}
                    onSelect={(c) => onChange('transport_company', c.name)}
                    options={transportCompanies}
                    displayField="name"
                  />
                </Field>
              </div>
              <Field
                label="Motorista responsável"
                className="max-w-xl"
                hint="Ao vincular, a placa deste veículo é preenchida automaticamente ao selecionar esse motorista em uma Movimentação ou Contrato de Frete."
              >
                <OptionAutocomplete
                  value={form.driver_id}
                  onChange={(v) => onChange('driver_id', v)}
                  options={drivers.map((d) => [d.id, d.name])}
                  testId="vehicle-driver"
                />
              </Field>
              {T({ name: 'observations', label: 'Observações' })}
              <label className="flex items-start gap-2 text-sm cursor-pointer" data-testid="vehicle-in-maintenance-plan">
                <Checkbox className="mt-0.5" checked={!!form.in_maintenance_plan} onCheckedChange={(v) => onChange('in_maintenance_plan', !!v)} />
                <span>
                  <span className="font-medium">Participa do Plano de Manutenção</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">Marque nos veículos da frota própria: só eles aparecem na Situação do Plano de Manutenção, nos avisos e no Registro de Manutenção.</span>
                </span>
              </label>
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>Cancelar</Button>
              <Button type="button" onClick={handleSubmit} disabled={saving} data-testid="vehicle-save-btn">
                {saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : 'Cadastrar veículo')}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
    </Layout>
  );
}
