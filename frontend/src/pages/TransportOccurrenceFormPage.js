import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { OptionAutocomplete } from '../components/Autocomplete';
import { ContainerPhotos, photoSrc } from '../components/SegregationPhotos';
import PhotoLightbox from '../components/checklist/PhotoLightbox';
import { useConfirm } from '../hooks/useConfirm';
import { compressImage } from '../lib/imageCompression';
import { todayISO } from '../lib/dates';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { toast } from 'sonner';
import { AlertOctagon, ClipboardList, Link2, CheckCircle2, Camera } from 'lucide-react';

// Mesmo limite do backend (MAX_PHOTOS em routers/transport_occurrences.py)
const MAX_PHOTOS = 6;
const OCCURRENCE_STATUS = { ABERTA: 'Aberta', RESOLVIDA: 'Resolvida' };

const buildEmptyForm = () => ({
  type_id: '', occurred_date: todayISO(), occurred_time: '', loading_order_id: '', vehicle_id: '', driver_id: '',
  location: '', description: '', cost: '', status: 'ABERTA', resolution: '',
});

const plateKey = (plate) => (plate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();

// Nova ocorrência (/transport-occurrences/new) e edição (/transport-occurrences/:id/edit)
export default function TransportOccurrenceFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate('/transport-occurrences');
  const { confirm, ConfirmDialog } = useConfirm();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(buildEmptyForm());
  const [photos, setPhotos] = useState([]); // já salvas
  const [staged, setStaged] = useState([]); // batidas aqui, vão ao salvar
  const [photoBusy, setPhotoBusy] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [types, setTypes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  useEffect(() => () => stagedRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  useEffect(() => {
    api.getTransportOccurrenceTypes().then((r) => setTypes(r.data || []))
      .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar os tipos de ocorrência')));
    api.getLoadingOrders().then((r) => setOrders(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    // Sem per_page a lista vem só com os 20 mais novos
    api.getVehicles({ per_page: 1000 }).then((r) => setVehicles(r.data?.items || [])).catch(() => {});
    api.getDrivers().then((r) => setDrivers(Array.isArray(r.data) ? r.data : [])).catch(() => {});

    if (!isEdit) return;
    api.getTransportOccurrence(id)
      .then(({ data }) => {
        const empty = buildEmptyForm();
        const loaded = { ...empty };
        for (const key of Object.keys(empty)) {
          if (data[key] !== undefined && data[key] !== null) loaded[key] = typeof empty[key] === 'string' ? String(data[key]) : data[key];
        }
        setForm(loaded);
        setPhotos(data.photos || []);
      })
      .catch((error) => {
        toast.error(apiErrorMessage(error, 'Erro ao carregar ocorrência'));
        backToList();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  // Escolher a ordem traz o veículo (pela placa do cavalo) e o motorista dela
  const selectOrder = (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    setForm((prev) => {
      const next = { ...prev, loading_order_id: orderId };
      if (!order) return next;
      const vehicle = vehicles.find((v) => plateKey(v.plate) === plateKey(order.truck_plate));
      if (vehicle && !prev.vehicle_id) next.vehicle_id = vehicle.id;
      if (order.driver_id && !prev.driver_id && drivers.some((d) => d.id === order.driver_id)) next.driver_id = order.driver_id;
      return next;
    });
  };

  const addPhoto = async (original) => {
    const file = await compressImage(original);
    if (!isEdit) {
      setStaged((prev) => [...prev, { id: `local-${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file) }]);
      return;
    }
    setPhotoBusy(true);
    try {
      const { data } = await api.uploadTransportOccurrencePhoto(id, file);
      setPhotos(data.photos || []);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao enviar foto'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async (photo) => {
    if (photo.file) {
      URL.revokeObjectURL(photo.preview);
      setStaged((prev) => prev.filter((p) => p.id !== photo.id));
      return;
    }
    if (!(await confirm('Remover esta foto?'))) return;
    setPhotoBusy(true);
    try {
      const { data } = await api.deleteTransportOccurrencePhoto(id, photo.id);
      setPhotos(data.photos || []);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao remover foto'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.type_id || !form.occurred_date || !form.description.trim()) {
      toast.error('Preencha o tipo, a data e a descrição da ocorrência');
      return;
    }
    const cost = form.cost === '' ? null : Number(String(form.cost).replace(',', '.'));
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) {
      toast.error('Custo inválido');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        occurred_time: form.occurred_time || null,
        loading_order_id: form.loading_order_id || null,
        vehicle_id: form.vehicle_id || null,
        driver_id: form.driver_id || null,
        cost,
      };
      let saved;
      if (isEdit) {
        saved = (await api.updateTransportOccurrence(id, payload)).data;
        toast.success('Ocorrência atualizada');
      } else {
        saved = (await api.createTransportOccurrence(payload)).data;
        toast.success(`Ocorrência nº ${saved.occurrence_number} registrada`);
        // Só agora a ocorrência existe: as fotos batidas vão em seguida
        const results = await Promise.allSettled(staged.map((p) => api.uploadTransportOccurrencePhoto(saved.id, p.file)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) toast.error(`${failed} foto(s) não foram enviadas. Abra a ocorrência e envie de novo.`);
      }
      backToList();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar ocorrência'));
    } finally {
      setSaving(false);
    }
  };

  // Tipo desativado continua aparecendo na ocorrência que já usa ele
  const typeOptions = types.filter((t) => t.active || t.id === form.type_id);
  const allPhotos = [...photos, ...staged];
  const orderOptions = orders.map((o) => [
    o.id, [`Nº ${o.order_number}`, o.truck_plate, o.driver_name, o.client_name].filter(Boolean).join(' · '),
  ]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="transport-occurrence-form-page">
        <PageHeader
          backTo={backToList}
          icon={AlertOctagon}
          title={isEdit ? 'Editar ocorrência' : 'Nova ocorrência'}
          subtitle="Ocorrência durante o transporte: o que aconteceu, onde, com quem e como foi resolvida"
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <FormSection title="Ocorrência" icon={ClipboardList}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Tipo" required className="col-span-2">
                  <Select value={form.type_id} onValueChange={(v) => onChange('type_id', v)}>
                    <SelectTrigger data-testid="occurrence-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {typeOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Data" required>
                  <Input type="date" value={form.occurred_date} onChange={(e) => onChange('occurred_date', e.target.value)} data-testid="occurrence-date" />
                </Field>
                <Field label="Hora">
                  <Input type="time" value={form.occurred_time} onChange={(e) => onChange('occurred_time', e.target.value)} data-testid="occurrence-time" />
                </Field>
                <Field label="Local" className="col-span-2">
                  <Input value={form.location} onChange={(e) => onChange('location', e.target.value)} data-testid="occurrence-location" />
                </Field>
                <Field label="Custo / prejuízo (R$)">
                  <Input inputMode="decimal" value={form.cost} onChange={(e) => onChange('cost', e.target.value)} data-testid="occurrence-cost" />
                </Field>
              </div>
              <Field label="Descrição" required>
                <Textarea rows={3} value={form.description} onChange={(e) => onChange('description', e.target.value)} data-testid="occurrence-description" />
              </Field>
            </FormSection>

            <FormSection title="Vínculo" icon={Link2}>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Field label="Ordem de Carregamento" hint="Ao escolher, o veículo e o motorista da ordem vêm junto.">
                  <OptionAutocomplete value={form.loading_order_id} onChange={selectOrder} options={orderOptions} testId="occurrence-order" />
                </Field>
                <Field label="Veículo">
                  <OptionAutocomplete
                    value={form.vehicle_id}
                    onChange={(v) => onChange('vehicle_id', v)}
                    options={vehicles.map((v) => [v.id, [v.plate, v.model].filter(Boolean).join(' · ')])}
                    testId="occurrence-vehicle"
                  />
                </Field>
                <Field label="Motorista">
                  <OptionAutocomplete
                    value={form.driver_id}
                    onChange={(v) => onChange('driver_id', v)}
                    options={drivers.map((d) => [d.id, d.name])}
                    testId="occurrence-driver"
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title={`Fotos (${allPhotos.length}/${MAX_PHOTOS})`} icon={Camera}>
              <ContainerPhotos
                photos={allPhotos}
                busy={photoBusy || saving}
                canEdit
                max={MAX_PHOTOS}
                alt="Foto da ocorrência"
                onAdd={addPhoto}
                onRemove={removePhoto}
                onOpen={setLightboxIndex}
                testId="occurrence-add-photo"
              />
            </FormSection>

            <FormSection title="Situação" icon={CheckCircle2}>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                <Field label="Situação">
                  <Select value={form.status} onValueChange={(v) => onChange('status', v)}>
                    <SelectTrigger data-testid="occurrence-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(OCCURRENCE_STATUS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Solução" className="lg:col-span-3" hint="O que foi feito: seguro acionado, carga substituída, multa paga...">
                  <Textarea rows={2} value={form.resolution} onChange={(e) => onChange('resolution', e.target.value)} data-testid="occurrence-resolution" />
                </Field>
              </div>
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>Cancelar</Button>
              <Button type="button" onClick={handleSubmit} disabled={saving || photoBusy} data-testid="occurrence-save-btn">
                {saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : 'Registrar ocorrência')}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
      <PhotoLightbox
        photos={allPhotos.map((p) => ({ id: p.id, src: photoSrc(p), label: 'Foto da ocorrência' }))}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
      />
      <ConfirmDialog />
    </Layout>
  );
}
