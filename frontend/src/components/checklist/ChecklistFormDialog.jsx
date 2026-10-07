import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Camera, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, ClipboardCheck,
  ImagePlus, Loader2, ShieldAlert, ShieldCheck, X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Autocomplete } from '../Autocomplete';
import { StatusPill } from '../DataPage';
import { motion } from '../Motion';
import { api } from '../../lib/api';
import { compressImage } from '../../lib/imageCompression';
import { useConfirm } from '../../hooks/useConfirm';
import { cn } from '../../lib/utils';
import ProgressRing from './ProgressRing';
import VehiclePhotoGuide from './VehiclePhotoGuide';
import PhotoLightbox from './PhotoLightbox';
import {
  CHECKLIST_PHOTO_LABELS, MAX_VEHICLE_CHECKLIST_PHOTOS, RESULT_META, VEHICLE_TYPE_LABELS, VEHICLE_TYPE_OPTIONS,
  checklistTypeForVehicle, countAnswers, photoSlotsFor, resultFromCounts,
} from './checklistShared';

// Formulário do Checklist de Veículo (modelo atual), em quatro etapas: veículo,
// itens de verificação, fotos guiadas pelo modelo 3D e conclusão. O resultado
// (aprovado / reprovado / pendente) e o progresso aparecem no topo enquanto a
// pessoa preenche. Checklists do modelo antigo (LVT) continuam no formulário
// antigo, dentro de VehicleChecklistPage.

const STEPS = [
  { key: 'vehicle', label: 'Veículo' },
  { key: 'items', label: 'Verificação' },
  { key: 'photos', label: 'Fotos' },
  { key: 'summary', label: 'Conclusão' },
];

const nowForInput = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

const emptyForm = () => ({
  vehicle_type: 'CAMINHAO',
  vehicle_plate: '',
  driver_id: '',
  driver_name: '',
  vistoriador_id: '',
  vistoriador_name: '',
  current_km: '',
  inspection_datetime: nowForInput(),
  observations: '',
});

const toSections = (sections) => (sections || []).map((section) => ({
  label: section.label,
  // O modelo do tipo de veículo traz só o texto; o checklist salvo traz a resposta junto
  items: (section.items || []).map((item) => (typeof item === 'string'
    ? { text: item, answer: null, note: '' }
    : { text: item.text, answer: item.answer || null, note: item.note || '' })),
}));

const photoSrc = (photo) => photo.preview || api.getFileUrl(photo.url);

const RESULT_TONES = {
  APROVADO: { ring: 'emerald', box: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100', icon: 'bg-emerald-500', Icon: ShieldCheck, title: 'Veículo aprovado' },
  REPROVADO: { ring: 'red', box: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100', icon: 'bg-red-500', Icon: ShieldAlert, title: 'Veículo reprovado' },
  PENDENTE: { ring: 'primary', box: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100', icon: 'bg-slate-400', Icon: CircleDashed, title: 'Conferência pendente' },
};

function AnswerToggle({ value, onChange, testId }) {
  const options = [
    { key: 'SIM', label: 'Sim', Icon: Check, on: 'border-emerald-600 bg-emerald-600 text-white', off: 'hover:border-emerald-400 hover:text-emerald-600' },
    { key: 'NAO', label: 'Não', Icon: X, on: 'border-red-600 bg-red-600 text-white', off: 'hover:border-red-400 hover:text-red-600' },
  ];
  return (
    <div className="flex shrink-0 gap-1.5" role="group">
      {options.map(({ key, label, Icon, on, off }) => (
        <motion.button
          key={key}
          type="button"
          whileTap={{ scale: 0.93 }}
          aria-pressed={value === key}
          data-testid={testId ? `${testId}-${key.toLowerCase()}` : undefined}
          onClick={() => onChange(value === key ? null : key)}
          className={cn(
            'inline-flex h-9 min-w-[60px] items-center justify-center gap-1 rounded-md border px-2 text-xs font-semibold transition-colors',
            value === key ? on : cn('border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400', off),
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </motion.button>
      ))}
    </div>
  );
}

// Bloco que abre e fecha animando a altura
function Collapse({ open, children }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const stepMotion = {
  enter: (direction) => ({ opacity: 0, x: direction * 28 }),
  center: { opacity: 1, x: 0 },
  exit: (direction) => ({ opacity: 0, x: direction * -28 }),
};

/**
 * `checklist`: o registro a editar, ou null pra criar um novo. `onSaved` é
 * chamado sempre que algo foi gravado no servidor (inclusive fotos enviadas
 * ou removidas numa edição que depois foi cancelada).
 */
export default function ChecklistFormDialog({ open, onOpenChange, checklist, drivers, vehicles, onSaved }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [form, setForm] = useState(emptyForm);
  const [sections, setSections] = useState([]);
  const [photos, setPhotos] = useState([]); // enviada: { id, type, url } · aguardando envio: { id, type, file, preview }
  const [editingId, setEditingId] = useState(null);
  const [number, setNumber] = useState(null);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [openSections, setOpenSections] = useState(() => new Set([0]));
  const [activeSlot, setActiveSlot] = useState('front');
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [busySlot, setBusySlot] = useState(null);
  const [saving, setSaving] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const bodyRef = useRef(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const pickingSlot = useRef('front');
  const advanceTimer = useRef(null);
  const dirty = useRef(false);         // algo foi preenchido e ainda não foi salvo
  const serverChanged = useRef(false); // algo já foi gravado no servidor nesta abertura
  const previews = useRef(new Set());

  const releasePreviews = () => {
    previews.current.forEach((url) => URL.revokeObjectURL(url));
    previews.current.clear();
  };

  const loadTemplate = async (vehicleType) => {
    setLoadingTemplate(true);
    try {
      const res = await api.getSimpleVehicleChecklistTemplate(vehicleType);
      setSections(toSections(res.data.sections));
      setOpenSections(new Set([0]));
    } catch (error) {
      setSections([]);
      toast.error('Erro ao carregar itens do checklist');
    } finally {
      setLoadingTemplate(false);
    }
  };

  // A cada abertura: carrega o registro (edição) ou começa em branco. Depende
  // do id, e não do objeto, pra recarregar a lista por trás não apagar o que
  // está sendo preenchido.
  const checklistId = checklist?.id || null;
  useEffect(() => {
    if (!open) return undefined;
    dirty.current = false;
    serverChanged.current = false;
    setStep(0);
    setDirection(1);
    setSaving('');
    setBusySlot(null);
    setLightboxIndex(null);
    if (checklist) {
      const loaded = toSections(checklist.checklist_sections);
      setEditingId(checklist.id);
      setNumber(checklist.checklist_number);
      setForm({
        vehicle_type: checklist.vehicle_type || 'CAMINHAO',
        vehicle_plate: checklist.vehicle_plate || '',
        driver_id: checklist.driver_id || '',
        driver_name: checklist.driver_name || '',
        vistoriador_id: checklist.vistoriador_id || '',
        vistoriador_name: checklist.vistoriador_name || '',
        current_km: checklist.current_km != null ? String(checklist.current_km) : '',
        inspection_datetime: checklist.inspection_datetime || '',
        observations: checklist.observations || '',
      });
      setSections(loaded);
      setPhotos(checklist.photos || []);
      // Abre só o que ainda pede atenção (item sem resposta ou reprovado)
      setOpenSections(new Set(loaded.map((section, index) => {
        const counts = countAnswers(section.items);
        return counts.pending > 0 || counts.failed > 0 ? index : -1;
      }).filter((index) => index >= 0)));
      const slots = photoSlotsFor(checklist.vehicle_type, checklist.photos || []);
      const missing = slots.find((slot) => !(checklist.photos || []).some((p) => p.type === slot.value));
      setActiveSlot(missing ? missing.value : null);
    } else {
      setEditingId(null);
      setNumber(null);
      setForm(emptyForm());
      setSections([]);
      setPhotos([]);
      setActiveSlot('front');
      loadTemplate('CAMINHAO');
    }
    return () => {
      clearTimeout(advanceTimer.current);
      releasePreviews();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checklistId]);

  const setField = (field, value) => {
    dirty.current = true;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // ----- Números que o topo e as etapas mostram -----
  const allItems = sections.flatMap((section) => section.items);
  const counts = countAnswers(allItems);
  const result = resultFromCounts(counts);
  const tone = RESULT_TONES[result];
  const slots = photoSlotsFor(form.vehicle_type, photos);
  const doneTypes = new Set(photos.map((photo) => photo.type));
  const doneSlots = slots.filter((slot) => doneTypes.has(slot.value)).length;
  const identified = !!form.vehicle_plate.trim() && !!form.driver_name.trim();
  const failedItems = allItems.filter((item) => item.answer === 'NAO');
  const stepMeta = [
    { done: identified, text: null },
    { done: counts.total > 0 && counts.pending === 0, text: counts.total ? `${counts.answered}/${counts.total}` : null },
    { done: slots.length > 0 && doneSlots === slots.length, text: `${doneSlots}/${slots.length}` },
    { done: false, text: null },
  ];

  const goTo = (next) => {
    if (next === step || next < 0 || next >= STEPS.length) return;
    setDirection(next > step ? 1 : -1);
    setStep(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  // ----- Etapa 1: veículo -----
  const changeVehicleType = async (nextType) => {
    if (nextType === form.vehicle_type) return;
    if (counts.answered > 0) {
      const ok = await confirm(
        'Os itens de verificação mudam conforme o tipo de veículo. As respostas já marcadas serão apagadas.',
        'Trocar o tipo de veículo?',
      );
      if (!ok) return;
    }
    setField('vehicle_type', nextType);
    loadTemplate(nextType);
  };

  const selectVehicle = (vehicle) => {
    setField('vehicle_plate', vehicle.plate);
    // O cadastro já diz o tipo: ajusta sozinho, desde que nada tenha sido respondido
    const mapped = checklistTypeForVehicle(vehicle);
    if (mapped && mapped !== form.vehicle_type && counts.answered === 0) {
      setField('vehicle_type', mapped);
      loadTemplate(mapped);
    }
  };

  // ----- Etapa 2: itens -----
  const toggleSection = (index) => setOpenSections((prev) => {
    const next = new Set(prev);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  // Seção toda conferida e sem apontamento: fecha e abre a próxima pendente
  const advanceFrom = (nextSections, sectionIndex) => {
    const sectionCounts = countAnswers(nextSections[sectionIndex].items);
    if (sectionCounts.pending > 0 || sectionCounts.failed > 0) return;
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      const isPending = (section) => countAnswers(section.items).pending > 0;
      let target = nextSections.findIndex((section, index) => index > sectionIndex && isPending(section));
      if (target < 0) target = nextSections.findIndex(isPending);
      setOpenSections((prev) => {
        const next = new Set(prev);
        next.delete(sectionIndex);
        if (target >= 0) next.add(target);
        return next;
      });
    }, 420);
  };

  const updateItems = (sectionIndex, mapItem) => {
    dirty.current = true;
    const nextSections = sections.map((section, index) => (index === sectionIndex
      ? { ...section, items: section.items.map(mapItem) }
      : section));
    setSections(nextSections);
    return nextSections;
  };
  const answerItem = (sectionIndex, itemIndex, answer) => {
    advanceFrom(updateItems(sectionIndex, (item, index) => (index === itemIndex ? { ...item, answer } : item)), sectionIndex);
  };
  const noteItem = (sectionIndex, itemIndex, note) => {
    updateItems(sectionIndex, (item, index) => (index === itemIndex ? { ...item, note } : item));
  };
  const approveRest = (sectionIndex) => {
    advanceFrom(updateItems(sectionIndex, (item) => (item.answer ? item : { ...item, answer: 'SIM' })), sectionIndex);
  };

  // ----- Etapa 3: fotos -----
  const pickPhoto = (slot, source) => {
    pickingSlot.current = slot;
    setActiveSlot(slot);
    const input = source === 'camera' ? cameraInputRef.current : galleryInputRef.current;
    if (input) input.click();
  };

  const addPhotos = async (type, fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const room = MAX_VEHICLE_CHECKLIST_PHOTOS - photos.length;
    if (room <= 0) {
      toast.error(`Máximo de ${MAX_VEHICLE_CHECKLIST_PHOTOS} fotos por checklist`);
      return;
    }
    if (files.length > room) toast.warning(`Só cabem mais ${room} foto(s): as demais ficaram de fora`);
    setBusySlot(type);
    try {
      const compressed = await Promise.all(files.slice(0, room).map((file) => compressImage(file)));
      let added = 0;
      if (editingId) {
        // Checklist já existe: a foto vai direto pro servidor
        const sent = await Promise.allSettled(compressed.map((file) => api.uploadVehicleChecklistPhoto(editingId, type, file)));
        const uploaded = sent.filter((r) => r.status === 'fulfilled').map((r) => r.value.data);
        added = uploaded.length;
        if (added > 0) {
          serverChanged.current = true;
          setPhotos((prev) => [...prev, ...uploaded]);
        }
        if (added < compressed.length) toast.error('Erro ao enviar foto');
      } else {
        // Checklist novo (ainda sem número): guarda aqui e envia ao salvar
        const staged = compressed.map((file) => {
          const preview = URL.createObjectURL(file);
          previews.current.add(preview);
          return { id: `local-${Date.now()}-${Math.random()}`, type, file, preview };
        });
        added = staged.length;
        dirty.current = true;
        setPhotos((prev) => [...prev, ...staged]);
      }
      if (added > 0) {
        // Segue pra próxima posição sem foto (o modelo 3D gira até ela)
        const done = new Set([...doneTypes, type]);
        const order = slots.map((slot) => slot.value);
        const from = order.indexOf(type);
        const next = [...order.slice(from + 1), ...order.slice(0, from)].find((value) => !done.has(value));
        setActiveSlot(next || null);
      }
    } finally {
      setBusySlot(null);
    }
  };

  const removePhoto = async (photo) => {
    if (photo.file) {
      URL.revokeObjectURL(photo.preview);
      previews.current.delete(photo.preview);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      return;
    }
    try {
      await api.deleteVehicleChecklistPhoto(editingId, photo.id);
      serverChanged.current = true;
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (error) {
      toast.error('Erro ao remover foto');
    }
  };

  // ----- Salvar -----
  // Sempre manda checklist_kind e as listas do modelo antigo vazias (senão o
  // backend recria os itens padrão do LVT). `photos` vai junto porque o PUT
  // troca o documento inteiro.
  const buildPayload = (sentPhotos) => ({
    checklist_kind: 'simple',
    vehicle_type: form.vehicle_type,
    vehicle_plate: form.vehicle_plate.trim(),
    driver_id: form.driver_id,
    driver_name: form.driver_name.trim(),
    vistoriador_id: form.vistoriador_id,
    vistoriador_name: form.vistoriador_name.trim(),
    current_km: form.current_km !== '' ? parseInt(form.current_km, 10) : null,
    inspection_datetime: form.inspection_datetime,
    observations: form.observations,
    documentos_items: [],
    vehicle_condition_items: [],
    epi_items: [],
    kit_items: [],
    tank_items: [],
    post_loading_items: [],
    products: [],
    checklist_sections: sections.map((section) => ({
      label: section.label,
      items: section.items.map((item) => ({
        text: item.text,
        answer: item.answer,
        note: item.answer === 'NAO' && item.note.trim() ? item.note.trim() : null,
      })),
    })),
    photos: sentPhotos.map((photo) => ({ id: photo.id, type: photo.type, url: photo.url })),
  });

  const handleSave = async () => {
    if (!identified) {
      toast.error('Preencha ao menos o motorista e a placa do veículo');
      goTo(0);
      return;
    }
    const creating = !editingId;
    setSaving(creating ? 'Criando...' : 'Salvando...');
    try {
      let id = editingId;
      if (creating) {
        const res = await api.createVehicleChecklist(buildPayload([]));
        id = res.data.id;
        serverChanged.current = true;
        // A partir daqui é uma edição: se o envio das fotos falhar, salvar de
        // novo não cria um segundo checklist
        setEditingId(id);
        setNumber(res.data.checklist_number);
      }
      let current = photos;
      const staged = current.filter((photo) => photo.file);
      if (staged.length > 0) {
        setSaving(`Enviando ${staged.length} foto${staged.length > 1 ? 's' : ''}...`);
        const sent = await Promise.allSettled(staged.map((photo) => api.uploadVehicleChecklistPhoto(id, photo.type, photo.file)));
        const uploaded = new Map();
        sent.forEach((r, index) => { if (r.status === 'fulfilled') uploaded.set(staged[index].id, r.value.data); });
        current = current.map((photo) => {
          if (!uploaded.has(photo.id)) return photo;
          URL.revokeObjectURL(photo.preview);
          previews.current.delete(photo.preview);
          return uploaded.get(photo.id);
        });
        setPhotos(current);
        const missing = staged.length - uploaded.size;
        if (missing > 0) {
          toast.error(`O checklist foi salvo, mas ${missing} foto${missing > 1 ? 's não foram enviadas' : ' não foi enviada'}. Salve de novo para tentar outra vez.`);
          return;
        }
      }
      if (!creating) {
        await api.updateVehicleChecklist(id, buildPayload(current.filter((photo) => !photo.file)));
      }
      dirty.current = false;
      toast.success(creating ? 'Checklist criado com sucesso!' : 'Checklist atualizado com sucesso!');
      onSaved?.();
      serverChanged.current = false;
      onOpenChange(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar checklist');
    } finally {
      setSaving('');
    }
  };

  const requestClose = async () => {
    if (saving) return;
    if (dirty.current && !(await confirm('O que foi preenchido e ainda não foi salvo será perdido.', 'Fechar sem salvar?'))) return;
    if (serverChanged.current) onSaved?.();
    onOpenChange(false);
  };

  const lightboxPhotos = photos.map((photo) => ({ id: photo.id, src: photoSrc(photo), label: CHECKLIST_PHOTO_LABELS[photo.type] || photo.type }));
  const allOpen = sections.length > 0 && openSections.size === sections.length;
  const isLast = step === STEPS.length - 1;
  // Fora da última etapa o botão é só "Salvar" (cabe no celular ao lado do Avançar)
  const saveLabel = saving || (!isLast ? 'Salvar' : editingId ? 'Salvar alterações' : 'Criar checklist');

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => { e.preventDefault(); e.currentTarget.focus(); }}
        className="flex h-dvh max-h-dvh w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 outline-none sm:h-[min(780px,92vh)] sm:rounded-xl"
        data-testid="checklist-form-dialog"
      >
        {/* Topo: título, resultado ao vivo e as etapas */}
        <div className="border-b border-slate-200 px-4 pt-4 dark:border-slate-700 sm:px-6">
          <div className="flex items-center gap-3 pr-8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base font-semibold leading-tight">
                {number ? `Checklist #${number}` : 'Novo Checklist'}
              </DialogTitle>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {VEHICLE_TYPE_LABELS[form.vehicle_type]}{form.vehicle_plate ? ` · ${form.vehicle_plate}` : ''}
              </p>
            </div>
            <StatusPill tone={RESULT_META[result].tone} className="hidden sm:inline-flex">{RESULT_META[result].label}</StatusPill>
            <ProgressRing value={counts.total ? counts.answered / counts.total : 0} tone={tone.ring} size={42}>
              <span className="text-[10px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                {counts.total ? Math.round((counts.answered / counts.total) * 100) : 0}%
              </span>
            </ProgressRing>
          </div>

          <div className="mt-3 grid grid-cols-4" role="tablist">
            {STEPS.map((item, index) => {
              const active = index === step;
              const meta = stepMeta[index];
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => goTo(index)}
                  data-testid={`checklist-step-${item.key}`}
                  className={cn(
                    'relative flex flex-col items-center gap-1 rounded-t-md px-1 pb-2.5 pt-1 text-[11px] font-medium outline-none transition-colors focus-visible:bg-primary/5 sm:flex-row sm:justify-center sm:gap-2 sm:text-xs',
                    active ? 'text-primary' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                  )}
                >
                  <span className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                    meta.done ? 'bg-emerald-500 text-white' : active ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                  )}>
                    {meta.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className="leading-none">{item.label}</span>
                  {meta.text && <span className="hidden tabular-nums text-slate-400 sm:inline">{meta.text}</span>}
                  {active && <motion.span layoutId="checklist-step-bar" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conteúdo da etapa */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepMotion}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {step === 0 && (
                <div className="space-y-5">
                  <div>
                    <Label className="mb-2 block">Tipo de Veículo *</Label>
                    <div className="grid grid-cols-3 gap-2" data-testid="simple-checklist-vehicle-type">
                      {VEHICLE_TYPE_OPTIONS.map(({ value, label, hint, icon: Icon }) => {
                        const selected = form.vehicle_type === value;
                        return (
                          <motion.button
                            key={value}
                            type="button"
                            whileTap={{ scale: 0.97 }}
                            aria-pressed={selected}
                            onClick={() => changeVehicleType(value)}
                            data-testid={`vehicle-type-${value}`}
                            className={cn(
                              'flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center transition-colors',
                              selected
                                ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary/40'
                                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600',
                            )}
                          >
                            <Icon className="h-6 w-6" />
                            <span className="text-sm font-semibold">{label}</span>
                            <span className="hidden text-[11px] text-slate-400 sm:block">{hint}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label>Placa do Veículo *</Label>
                      <Autocomplete
                        value={form.vehicle_plate}
                        onChange={(value) => setField('vehicle_plate', value.toUpperCase())}
                        options={vehicles}
                        displayField={(v) => `${v.plate}${v.model ? ` - ${v.model}` : ''}`}
                        onSelect={selectVehicle}
                        testId="checklist-plate"
                      />
                    </div>
                    <div>
                      <Label htmlFor="checklist_km">Km Atual</Label>
                      <Input
                        id="checklist_km"
                        inputMode="numeric"
                        className="h-9"
                        value={form.current_km !== '' ? Number(form.current_km).toLocaleString('pt-BR') : ''}
                        onChange={(e) => setField('current_km', e.target.value.replace(/\D/g, '').slice(0, 8))}
                        data-testid="checklist-km"
                      />
                    </div>
                    <div>
                      <Label>Motorista *</Label>
                      <Autocomplete
                        value={form.driver_name}
                        onChange={(value) => setForm((prev) => { dirty.current = true; return { ...prev, driver_name: value, driver_id: '' }; })}
                        options={drivers}
                        displayField="name"
                        onSelect={(d) => setForm((prev) => ({ ...prev, driver_id: d.id, driver_name: d.name }))}
                        testId="checklist-driver"
                      />
                    </div>
                    <div>
                      <Label>Vistoriador</Label>
                      <Autocomplete
                        value={form.vistoriador_name}
                        onChange={(value) => setForm((prev) => { dirty.current = true; return { ...prev, vistoriador_name: value, vistoriador_id: '' }; })}
                        options={drivers}
                        displayField="name"
                        onSelect={(d) => setForm((prev) => ({ ...prev, vistoriador_id: d.id, vistoriador_name: d.name }))}
                        testId="checklist-inspector"
                      />
                    </div>
                    <div>
                      <Label htmlFor="checklist_datetime">Data e Hora</Label>
                      <Input
                        id="checklist_datetime"
                        type="datetime-local"
                        className="h-9"
                        value={form.inspection_datetime}
                        onChange={(e) => setField('inspection_datetime', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{counts.answered}</span> de{' '}
                      <span className="tabular-nums">{counts.total}</span> itens conferidos
                      {counts.failed > 0 && <span className="font-medium text-red-600 dark:text-red-400"> · {counts.failed} reprovado{counts.failed > 1 ? 's' : ''}</span>}
                    </p>
                    {sections.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setOpenSections(allOpen ? new Set() : new Set(sections.map((_, index) => index)))}
                        className="shrink-0 text-xs font-medium text-primary hover:underline"
                      >
                        {allOpen ? 'Recolher tudo' : 'Expandir tudo'}
                      </button>
                    )}
                  </div>

                  {loadingTemplate && (
                    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando itens...
                    </div>
                  )}
                  {!loadingTemplate && sections.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
                      Não foi possível carregar os itens deste tipo de veículo.
                      <div className="mt-3">
                        <Button type="button" variant="outline" size="sm" onClick={() => loadTemplate(form.vehicle_type)}>Tentar de novo</Button>
                      </div>
                    </div>
                  )}

                  {!loadingTemplate && sections.map((section, sectionIndex) => {
                    const sectionCounts = countAnswers(section.items);
                    const isOpen = openSections.has(sectionIndex);
                    const complete = sectionCounts.pending === 0;
                    return (
                      <div
                        key={section.label}
                        className={cn(
                          'overflow-hidden rounded-lg border transition-colors',
                          sectionCounts.failed > 0 ? 'border-red-200 dark:border-red-500/30' : complete ? 'border-emerald-200 dark:border-emerald-500/30' : 'border-slate-200 dark:border-slate-700',
                        )}
                        data-testid={`checklist-section-${sectionIndex}`}
                      >
                        <div className="flex items-center gap-2 bg-slate-50 pr-2 dark:bg-slate-800/60">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => toggleSection(sectionIndex)}
                            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                          >
                            <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200', isOpen && 'rotate-180')} />
                            <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{section.label}</span>
                            <span className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                              sectionCounts.failed > 0
                                ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                                : complete
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                  : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                            )}>
                              {sectionCounts.answered}/{sectionCounts.total}
                            </span>
                          </button>
                          {!complete && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => approveRest(sectionIndex)}
                              title="Marca Sim nos itens ainda sem resposta"
                              className="h-8 shrink-0 gap-1 px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                              data-testid={`checklist-section-${sectionIndex}-all-ok`}
                            >
                              <CheckCheck className="h-3.5 w-3.5" /> Tudo OK
                            </Button>
                          )}
                        </div>
                        <Collapse open={isOpen}>
                          <div className="divide-y divide-slate-100 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                            {section.items.map((item, itemIndex) => (
                              <div key={item.text} className={cn('px-3 py-2.5 transition-colors', item.answer === 'NAO' && 'bg-red-50/70 dark:bg-red-500/5')}>
                                <div className="flex items-center gap-3">
                                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">{item.text}</span>
                                  <AnswerToggle
                                    value={item.answer}
                                    onChange={(answer) => answerItem(sectionIndex, itemIndex, answer)}
                                    testId={`checklist-item-${sectionIndex}-${itemIndex}`}
                                  />
                                </div>
                                <Collapse open={item.answer === 'NAO'}>
                                  <div className="pt-2">
                                    <Label htmlFor={`note-${sectionIndex}-${itemIndex}`} className="mb-1 block text-xs font-medium text-red-700 dark:text-red-300">
                                      O que foi encontrado
                                    </Label>
                                    <Input
                                      id={`note-${sectionIndex}-${itemIndex}`}
                                      value={item.note}
                                      maxLength={200}
                                      onChange={(e) => noteItem(sectionIndex, itemIndex, e.target.value)}
                                      className="h-9 bg-white text-sm dark:bg-slate-900"
                                      data-testid={`checklist-item-${sectionIndex}-${itemIndex}-note`}
                                    />
                                  </div>
                                </Collapse>
                              </div>
                            ))}
                          </div>
                        </Collapse>
                      </div>
                    );
                  })}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <VehiclePhotoGuide vehicleType={form.vehicle_type} slots={slots} active={activeSlot} doneTypes={doneTypes} />
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{doneSlots}</span> de {slots.length} posições fotografadas
                    </span>
                    <span className="tabular-nums">{photos.length}/{MAX_VEHICLE_CHECKLIST_PHOTOS} fotos</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {slots.map((slot, index) => {
                      const slotPhotos = photos.filter((photo) => photo.type === slot.value);
                      const done = slotPhotos.length > 0;
                      const active = activeSlot === slot.value;
                      const full = photos.length >= MAX_VEHICLE_CHECKLIST_PHOTOS;
                      return (
                        <div
                          key={slot.value}
                          onClick={() => setActiveSlot(slot.value)}
                          className={cn(
                            'cursor-pointer rounded-lg border p-2.5 transition-colors',
                            active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
                          )}
                          data-testid={`photo-slot-${slot.value}`}
                        >
                          <div className="flex items-center gap-2">
                            <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-pressed={active}>
                              <span className={cn(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                                done ? 'bg-emerald-500 text-white' : active ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                              )}>
                                {busySlot === slot.value ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{slot.label}</span>
                                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                                  {done ? `${slotPhotos.length} foto${slotPhotos.length > 1 ? 's' : ''}` : 'Sem foto'}
                                </span>
                              </span>
                            </button>
                            <Button
                              type="button"
                              size="sm"
                              variant={done ? 'outline' : 'default'}
                              disabled={full || !!busySlot}
                              onClick={(e) => { e.stopPropagation(); pickPhoto(slot.value, 'camera'); }}
                              className="h-8 gap-1.5 px-2.5 text-xs"
                              data-testid={`photo-slot-${slot.value}-camera`}
                            >
                              <Camera className="h-3.5 w-3.5" /> Câmera
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={full || !!busySlot}
                              onClick={(e) => { e.stopPropagation(); pickPhoto(slot.value, 'gallery'); }}
                              title="Escolher da galeria"
                              aria-label={`Escolher foto de ${slot.label} da galeria`}
                              className="h-8 w-8 p-0"
                              data-testid={`photo-slot-${slot.value}-gallery`}
                            >
                              <ImagePlus className="h-4 w-4" />
                            </Button>
                          </div>
                          {done && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {slotPhotos.map((photo) => (
                                <motion.div
                                  key={photo.id}
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                                  className="relative h-16 w-[88px] overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
                                >
                                  <img
                                    src={photoSrc(photo)}
                                    alt={slot.label}
                                    onClick={(e) => { e.stopPropagation(); setLightboxIndex(photos.findIndex((p) => p.id === photo.id)); }}
                                    className="h-full w-full cursor-zoom-in object-cover"
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); removePhoto(photo); }}
                                    aria-label={`Remover foto de ${slot.label}`}
                                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow hover:bg-red-700"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </motion.div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => { addPhotos(pickingSlot.current, e.target.files); e.target.value = ''; }}
                    data-testid="new-checklist-photo-input"
                  />
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { addPhotos(pickingSlot.current, e.target.files); e.target.value = ''; }}
                    data-testid="new-checklist-gallery-input"
                  />
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <motion.div
                    key={result}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                    className={cn('flex items-start gap-3 rounded-xl border p-4', tone.box)}
                    data-testid="checklist-result-box"
                  >
                    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white', tone.icon)}>
                      <tone.Icon className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold leading-tight">{tone.title}</p>
                      <p className="mt-0.5 text-sm opacity-80">
                        {result === 'APROVADO' && `Os ${counts.total} itens foram conferidos sem apontamentos.`}
                        {result === 'REPROVADO' && `${counts.failed} ${counts.failed > 1 ? 'itens reprovados' : 'item reprovado'}${counts.pending > 0 ? ` e ${counts.pending} ainda sem resposta` : ''}.`}
                        {result === 'PENDENTE' && (counts.total ? `Faltam ${counts.pending} de ${counts.total} itens para concluir a conferência.` : 'Nenhum item de verificação neste checklist.')}
                      </p>
                      {failedItems.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm">
                          {failedItems.map((item) => (
                            <li key={item.text} className="flex gap-1.5">
                              <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>
                                <span className="font-medium">{item.text}</span>
                                {item.note.trim() && <span className="opacity-80"> — {item.note.trim()}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </motion.div>

                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                    {[
                      { label: 'Veículo', ok: identified, text: identified ? `${VEHICLE_TYPE_LABELS[form.vehicle_type]} · ${form.vehicle_plate} · ${form.driver_name}` : 'Falta informar a placa e o motorista', to: 0 },
                      { label: 'Verificação', ok: counts.total > 0 && counts.pending === 0, text: `${counts.answered} de ${counts.total} itens conferidos`, to: 1 },
                      { label: 'Fotos', ok: doneSlots === slots.length, text: doneSlots === slots.length ? `${photos.length} foto${photos.length === 1 ? '' : 's'}, todas as posições` : `Sem foto: ${slots.filter((slot) => !doneTypes.has(slot.value)).map((slot) => slot.label).join(', ')}`, to: 2 },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center gap-3 px-3 py-2.5">
                        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', row.ok ? 'bg-emerald-500 text-white' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300')}>
                          {row.ok ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs font-bold">!</span>}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{row.label}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{row.text}</p>
                        </div>
                        <button type="button" onClick={() => goTo(row.to)} className="shrink-0 text-xs font-medium text-primary hover:underline">
                          {row.ok ? 'Rever' : 'Completar'}
                        </button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <Label htmlFor="checklist_observations">Observações</Label>
                    <Textarea
                      id="checklist_observations"
                      rows={3}
                      value={form.observations}
                      onChange={(e) => setField('observations', e.target.value)}
                      data-testid="checklist-observations"
                    />
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Rodapé: navegação entre etapas e salvar */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40 sm:px-6">
          <Button type="button" variant="ghost" onClick={() => (step === 0 ? requestClose() : goTo(step - 1))} disabled={!!saving} className="gap-1 px-2.5">
            {step === 0 ? 'Cancelar' : <><ChevronLeft className="h-4 w-4" /> Voltar</>}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isLast ? 'default' : 'outline'}
              onClick={handleSave}
              disabled={!!saving}
              className="gap-1.5"
              data-testid="checklist-save-button"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saveLabel}
            </Button>
            {!isLast && (
              <Button type="button" onClick={() => goTo(step + 1)} disabled={!!saving} className="gap-1" data-testid="checklist-next-button">
                Avançar <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <PhotoLightbox photos={lightboxPhotos} index={lightboxIndex} onIndexChange={setLightboxIndex} />
        <ConfirmDialog />
      </DialogContent>
    </Dialog>
  );
}
