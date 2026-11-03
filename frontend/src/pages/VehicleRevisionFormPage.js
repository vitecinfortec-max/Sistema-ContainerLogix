import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { sanitizeKmInput } from '../lib/utils';
import { toast } from 'sonner';
import { Wrench, Camera, Upload, X, Truck, Gauge, Users } from 'lucide-react';
import { compressImage } from '../lib/imageCompression';
import { dateInputToISO, toDateInput, todayISO } from '../lib/dates';
import { formatPlate, plateKey } from '../lib/masks';

const LIST_PATH = '/fleet?tab=revisions';

// Próximas trocas do cavalo mecânico (KM)
const NEXT_KM_FIELDS = [
  ['next_oil_motor_km', 'Óleo Motor'],
  ['next_oil_filter_km', 'Filtro Óleo'],
  ['next_air_filter_km', 'Filtro Ar'],
  ['next_ac_filter_km', 'Filtro Ar Condicionado'],
  ['next_fuel_filter_km', 'Filtro Combustível'],
  ['next_racor_filter_km', 'Filtro Racor'],
  ['next_apu_filter_km', 'Filtro APU'],
  ['next_hydraulic_filter_km', 'Filtro Hidráulico'],
  ['next_gearbox_oil_km', 'Óleo Caixa de Marcha'],
  ['next_differential_oil_km', 'Óleo Diferencial'],
  ['next_lubrication_km', 'Lubrificação'],
  ['next_washing_km', 'Lavagem'],
];

const CARRETA_REVISION_TYPES = [
  ['FREIOS', 'Freios'],
  ['PNEUS', 'Pneus'],
  ['SUSPENSAO', 'Suspensão'],
  ['ELETRICA', 'Elétrica'],
  ['ESTRUTURA', 'Estrutura'],
  ['LONA', 'Lona/Sider'],
  ['GERAL', 'Revisão Geral'],
  ['OUTROS', 'Outros'],
];

const emptyForm = () => ({
  vehicle_type_revision: 'CAVALO', // CAVALO ou CARRETA
  vehicle_plate: '',
  vehicle_model: '',
  revision_date: todayISO(),
  oil_used: '',
  current_km: '',
  ...Object.fromEntries(NEXT_KM_FIELDS.map(([field]) => [field, ''])),
  mechanic_name: '',
  performed_by: '',
  observations: '',
  carreta_revision_type: '',
});

const kmOrNull = (value) => (value ? parseInt(value, 10) : null);

// Nova revisão (/fleet/revisoes/new) e edição (/fleet/revisoes/:id/edit) do
// Controle de Revisão
export default function VehicleRevisionFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate(LIST_PATH);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm());
  const [revisionNumber, setRevisionNumber] = useState(null);
  // Foto do Km (hodômetro) - vai junto ao salvar (CAVALO)
  const [kmPhoto, setKmPhoto] = useState(null); // { file, previewUrl }
  // Lista completa de veículos para o autocomplete de Placa
  const [allVehicles, setAllVehicles] = useState([]);

  useEffect(() => () => { if (kmPhoto?.previewUrl) URL.revokeObjectURL(kmPhoto.previewUrl); }, [kmPhoto]);

  useEffect(() => {
    (async () => {
      const vehicles = await api.getVehicles({ per_page: 1000 }).then((res) => res.data?.items || []).catch(() => []);
      setAllVehicles(vehicles);
      if (!isEdit) return;
      try {
        const { data: revision } = await api.getVehicleRevision(id);
        // Carreta não tem KM e guarda o tipo de revisão no campo do óleo (ver handleSubmit)
        const vehicle = vehicles.find((v) => plateKey(v.plate) === plateKey(revision.vehicle_plate));
        const isCarreta = vehicle ? vehicle.vehicle_type === 'CARRETA' : !revision.current_km;
        const km = (v) => (v === null || v === undefined ? '' : String(v));
        setRevisionNumber(revision.revision_number);
        setFormData({
          ...emptyForm(),
          vehicle_type_revision: isCarreta ? 'CARRETA' : 'CAVALO',
          vehicle_plate: revision.vehicle_plate || '',
          vehicle_model: revision.vehicle_model || '',
          revision_date: toDateInput(revision.revision_date) || todayISO(),
          oil_used: isCarreta ? '' : (revision.oil_used || ''),
          carreta_revision_type: isCarreta ? (revision.oil_used || '') : '',
          current_km: isCarreta ? '' : km(revision.current_km),
          ...Object.fromEntries(NEXT_KM_FIELDS.map(([field]) => [field, km(revision[field])])),
          mechanic_name: revision.mechanic_name || '',
          performed_by: revision.performed_by || '',
          observations: revision.observations || '',
        });
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Não foi possível carregar a revisão');
        backToList();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleInputChange = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  // Campos de KM digitados como texto em vez de <input type="number" min="0">
  // - ver sanitizeKmInput em lib/utils.js pro motivo.
  const handleKmChange = (field) => (e) => {
    const v = sanitizeKmInput(e.target.value);
    if (v !== null) handleInputChange(field, v);
  };

  const handleAddKmPhoto = async (file) => {
    if (!file) return;
    const compressed = await compressImage(file);
    setKmPhoto({ file: compressed, previewUrl: URL.createObjectURL(compressed) });
  };

  const pickVehicle = (v) => {
    handleInputChange('vehicle_plate', formatPlate(v.plate));
    handleInputChange('vehicle_model', v.model || '');
  };

  const handleSubmit = async () => {
    const isCavalo = formData.vehicle_type_revision === 'CAVALO';
    if (isCavalo) {
      if (!formData.vehicle_plate || !formData.oil_used || !formData.current_km || !formData.mechanic_name) {
        toast.error('Preencha os campos obrigatórios');
        return;
      }
    } else if (!formData.vehicle_plate || !formData.carreta_revision_type || !formData.mechanic_name) {
      toast.error('Preencha os campos obrigatórios (Placa, Tipo de Revisão, Mecânico)');
      return;
    }

    setSaving(true);
    try {
      const data = isCavalo
        ? {
          vehicle_type_revision: 'CAVALO',
          vehicle_plate: formatPlate(formData.vehicle_plate),
          vehicle_model: formData.vehicle_model || null,
          revision_date: dateInputToISO(formData.revision_date),
          oil_used: formData.oil_used,
          current_km: parseInt(formData.current_km, 10),
          ...Object.fromEntries(NEXT_KM_FIELDS.map(([field]) => [field, kmOrNull(formData[field])])),
          mechanic_name: formData.mechanic_name,
          performed_by: formData.performed_by || null,
          observations: formData.observations || null,
        }
        : {
          // Carreta: formulário simplificado
          vehicle_type_revision: 'CARRETA',
          vehicle_plate: formatPlate(formData.vehicle_plate),
          vehicle_model: formData.vehicle_model || null,
          revision_date: dateInputToISO(formData.revision_date),
          oil_used: formData.carreta_revision_type, // tipo de revisão no "oil_used" para manter compatibilidade
          current_km: 0, // Carreta não tem KM
          mechanic_name: formData.mechanic_name,
          performed_by: formData.performed_by || null,
          observations: formData.observations || null,
          carreta_revision_type: formData.carreta_revision_type,
        };

      const response = isEdit ? await api.updateVehicleRevision(id, data) : await api.createVehicleRevision(data);
      if (kmPhoto?.file) {
        try {
          await api.uploadVehicleRevisionKmPhoto(response.data.id, kmPhoto.file);
        } catch (photoError) {
          toast.error('Revisão registrada, mas houve erro ao enviar a foto do Km');
        }
      }
      toast.success(isEdit ? 'Revisão atualizada' : 'Revisão registrada');
      backToList();
    } catch (error) {
      toast.error(error.response?.data?.detail || (isEdit ? 'Erro ao atualizar revisão' : 'Erro ao registrar revisão'));
    } finally {
      setSaving(false);
    }
  };

  const isCavalo = formData.vehicle_type_revision === 'CAVALO';
  const plateField = (
    <Autocomplete
      value={formData.vehicle_plate}
      onChange={(v) => handleInputChange('vehicle_plate', formatPlate(v))}
      onSelect={pickVehicle}
      options={allVehicles}
      displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
      testId="revision-plate-input"
    />
  );

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="vehicle-revision-form-page">
        <PageHeader
          icon={Wrench}
          title={isEdit ? `Editar revisão${revisionNumber ? ` #${revisionNumber}` : ''}` : 'Nova revisão de veículo'}
          subtitle="Revisões e trocas de óleo dos veículos"
          backTo={LIST_PATH}
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <FormSection title="Veículo" icon={Truck}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Tipo de veículo" required hint={isEdit ? 'Não muda depois de registrada' : undefined}>
                  <Select
                    value={formData.vehicle_type_revision}
                    onValueChange={(value) => handleInputChange('vehicle_type_revision', value)}
                    disabled={isEdit}
                  >
                    <SelectTrigger className="h-9" data-testid="revision-vehicle-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CAVALO">Cavalo Mecânico</SelectItem>
                      <SelectItem value="CARRETA">Carreta</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={isCavalo ? 'Placa do veículo' : 'Placa'} required>{plateField}</Field>
                <Field label="Modelo">
                  <Input className="h-9" value={formData.vehicle_model} onChange={(e) => handleInputChange('vehicle_model', e.target.value)} />
                </Field>
              </div>

              {isCavalo ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field label="Data da revisão" required>
                    <Input className="h-9" type="date" value={formData.revision_date} onChange={(e) => handleInputChange('revision_date', e.target.value)} />
                  </Field>
                  <Field label="Óleo utilizado" required>
                    <Input className="h-9" value={formData.oil_used} onChange={(e) => handleInputChange('oil_used', e.target.value)} data-testid="revision-oil-input" />
                  </Field>
                  <Field label="KM atual (trocado com)" required>
                    <Input className="h-9" type="text" inputMode="decimal" value={formData.current_km} onChange={handleKmChange('current_km')} data-testid="revision-km-input" />
                  </Field>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field label="Tipo de revisão" required>
                    <Select value={formData.carreta_revision_type} onValueChange={(value) => handleInputChange('carreta_revision_type', value)}>
                      <SelectTrigger className="h-9" data-testid="revision-carreta-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CARRETA_REVISION_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Data da revisão">
                    <Input className="h-9" type="date" value={formData.revision_date} onChange={(e) => handleInputChange('revision_date', e.target.value)} />
                  </Field>
                </div>
              )}

              {isCavalo && (
                <Field label="Foto do Km (hodômetro)">
                  {kmPhoto ? (
                    <div className="relative inline-block">
                      <img src={kmPhoto.previewUrl} alt="Foto do Km" className="w-40 h-28 object-cover rounded-lg border" />
                      <Button
                        title="Remover" aria-label="Remover"
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => setKmPhoto(null)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" className="h-9" onClick={() => document.getElementById('km-photo-camera-input').click()}>
                        <Camera className="w-4 h-4 mr-2" />
                        Câmera
                      </Button>
                      <Button type="button" variant="outline" className="h-9" onClick={() => document.getElementById('km-photo-gallery-input').click()}>
                        <Upload className="w-4 h-4 mr-2" />
                        Galeria
                      </Button>
                      <input id="km-photo-camera-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { handleAddKmPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                      <input id="km-photo-gallery-input" type="file" accept="image/*" className="hidden" onChange={(e) => { handleAddKmPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                    </div>
                  )}
                </Field>
              )}
            </FormSection>

            {isCavalo && (
              <FormSection title="Próxima revisão (KM)" icon={Gauge}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {NEXT_KM_FIELDS.map(([field, label]) => (
                    <Field key={field} label={label}>
                      <Input className="h-9" type="text" inputMode="decimal" value={formData[field]} onChange={handleKmChange(field)} />
                    </Field>
                  ))}
                </div>
              </FormSection>
            )}

            <FormSection title="Responsáveis" icon={Users}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nome do mecânico" required>
                  <Input className="h-9" value={formData.mechanic_name} onChange={(e) => handleInputChange('mechanic_name', e.target.value)} data-testid="revision-mechanic-input" />
                </Field>
                <Field label="Realizado por">
                  <Input className="h-9" value={formData.performed_by} onChange={(e) => handleInputChange('performed_by', e.target.value)} />
                </Field>
              </div>
              <Field label={isCavalo ? 'Observações' : 'Observação'}>
                <Input className="h-9" value={formData.observations} onChange={(e) => handleInputChange('observations', e.target.value)} />
              </Field>
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>Cancelar</Button>
              <Button type="button" onClick={handleSubmit} disabled={saving} data-testid="revision-save-btn">
                {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Registrar revisão'}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
    </Layout>
  );
}
