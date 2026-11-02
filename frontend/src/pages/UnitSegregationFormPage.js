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
import { Autocomplete } from '../components/Autocomplete';
import { ContainerPhotos, photoSrc } from '../components/SegregationPhotos';
import PhotoLightbox from '../components/checklist/PhotoLightbox';
import { api } from '../lib/api';
import { useConfirm } from '../hooks/useConfirm';
import { toast } from 'sonner';
import { Package, Plus, Trash2, Users, Container } from 'lucide-react';
import { formatContainerNumber } from '../lib/containerNumber';
import { compressImage } from '../lib/imageCompression';

const emptyItem = () => ({ container_number: '', tare: '', shipping_line: '', photos: [], staged: [] });

// Nova segregação (/unit-segregation/new) e edição (/unit-segregation/:id/edit,
// só enquanto está ATIVA)
export default function UnitSegregationFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const backToList = () => navigate('/unit-segregation');

  const [loading, setLoading] = useState(isEdit);
  const [editingItem, setEditingItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [clientName, setClientName] = useState('');
  const [formData, setFormData] = useState({ client_id: '', items: [emptyItem()], observations: '' });
  const [lightbox, setLightbox] = useState({ photos: [], index: null });

  // Libera as prévias das fotos batidas e não salvas ao sair da tela
  const itemsRef = useRef(formData.items);
  itemsRef.current = formData.items;
  useEffect(() => () => {
    itemsRef.current.forEach((item) => item.staged.forEach((photo) => URL.revokeObjectURL(photo.preview)));
  }, []);

  useEffect(() => {
    Promise.all([api.getClients(), api.getShippingLines()])
      .then(([clientsRes, shippingRes]) => {
        setClients(clientsRes.data || []);
        setShippingLines(shippingRes.data || []);
      })
      .catch(() => toast.error('Erro ao carregar clientes e armadores'));

    if (!isEdit) return;
    api.getUnitSegregation(id)
      .then(({ data: item }) => {
        if (item.status !== 'ATIVO') {
          toast.error('Só é possível editar uma segregação ativa');
          backToList();
          return;
        }
        setEditingItem(item);
        setClientName(item.client_name || '');
        setFormData({
          client_id: item.client_id,
          items: item.items && item.items.length > 0
            ? item.items.map((i) => ({
              container_number: i.container_number || '',
              tare: i.tare || '',
              shipping_line: i.shipping_line || '',
              photos: i.photos || [],
              staged: [],
            }))
            : [emptyItem()],
          observations: item.observations || '',
        });
      })
      .catch((error) => {
        toast.error(error.response?.data?.detail || 'Não foi possível carregar a segregação');
        backToList();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Cliente: só vale o escolhido na lista; digitar outro nome desfaz a escolha
  const changeClientText = (text) => {
    setClientName(text);
    setFormData((prev) => ({ ...prev, client_id: '' }));
  };
  const selectClient = (client) => {
    setClientName(client.name);
    setFormData((prev) => ({ ...prev, client_id: client.id }));
  };

  const addItem = () => setFormData((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));

  const removeItem = async (index) => {
    if (formData.items.length <= 1) return;
    const item = formData.items[index];
    if (item.photos.length > 0 && !(await confirm(`Tirar o container ${item.container_number} da segregação? As fotos dele serão apagadas ao salvar.`))) return;
    item.staged.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setFormData((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  const updateItem = (index, field, value) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (
        i === index ? { ...item, [field]: field === 'container_number' ? value.toUpperCase() : value } : item
      )),
    }));
  };

  // Ao sair do campo Container, puxa tara e armador da entrada em aberto.
  // Só preenche o que está em branco, pra não apagar o que já foi digitado.
  const fillFromEntry = async (index, raw) => {
    const number = formatContainerNumber(raw);
    updateItem(index, 'container_number', number);
    if (!/^[A-Z]{4}\d{6}-\d$/.test(number)) return;
    try {
      const { entry } = (await api.getOpenEntryForContainer(number)).data;
      if (!entry) {
        toast.info(`Container ${number} sem entrada em aberto: preencha a tara e o armador`);
        return;
      }
      const lineName = (entry.shipping_line || '').trim().toLowerCase();
      const line = shippingLines.find((sl) => sl.id === entry.shipping_line || sl.name.trim().toLowerCase() === lineName);
      // Confere o número de novo: a linha pode ter mudado enquanto a busca respondia
      setFormData((prev) => ({
        ...prev,
        items: prev.items.map((item, i) => (i === index && item.container_number === number ? {
          ...item,
          tare: item.tare || entry.tare || '',
          shipping_line: item.shipping_line || line?.id || '',
        } : item)),
      }));
    } catch (error) {
      console.error('Erro ao buscar a entrada do container:', error);
    }
  };

  // A foto só fica guardada aqui e vai junto ao salvar
  const stagePhoto = async (index, original) => {
    const file = await compressImage(original);
    const photo = { id: `local-${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file) };
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, staged: [...item.staged, photo] } : item)),
    }));
  };

  const removeFormPhoto = async (index, photo) => {
    if (photo.file) {
      URL.revokeObjectURL(photo.preview);
      setFormData((prev) => ({
        ...prev,
        items: prev.items.map((item, i) => (i === index ? { ...item, staged: item.staged.filter((p) => p.id !== photo.id) } : item)),
      }));
      return;
    }
    if (!(await confirm('Remover esta foto?'))) return;
    try {
      await api.deleteUnitSegregationPhoto(editingItem.id, formData.items[index].container_number, photo.id);
      setFormData((prev) => ({
        ...prev,
        items: prev.items.map((item, i) => (i === index ? { ...item, photos: item.photos.filter((p) => p.id !== photo.id) } : item)),
      }));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao remover foto');
    }
  };

  const openLightbox = (photos, index, containerNumber) => {
    setLightbox({ photos: photos.map((p) => ({ id: p.id, src: photoSrc(p), label: containerNumber || 'Foto do container' })), index });
  };

  const handleSubmit = async () => {
    if (!formData.client_id) {
      toast.error('Selecione o cliente reservado na lista');
      return;
    }
    const validItems = formData.items.filter((item) => item.container_number && item.shipping_line);
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um container com número e armador');
      return;
    }
    // A linha incompleta não é salva: sem este aviso, a foto dela sumiria calada
    if (formData.items.some((item) => item.staged.length > 0 && !validItems.includes(item))) {
      toast.error('Preencha o número e o armador dos containers que têm foto');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        client_id: formData.client_id,
        items: validItems.map(({ container_number, tare, shipping_line }) => ({ container_number, tare, shipping_line })),
        observations: formData.observations,
      };
      let saved;
      if (editingItem) {
        saved = (await api.updateUnitSegregation(editingItem.id, payload)).data;
        toast.success('Segregação atualizada');
      } else {
        saved = (await api.createUnitSegregation(payload)).data;
        toast.success('Segregação criada');
      }

      // Só aqui a segregação existe com certeza: as fotos batidas vão agora.
      // Se alguma falhar a reserva já está salva, então avisa em vez de perder calado.
      const uploads = validItems.flatMap((item) => item.staged.map((photo) => (
        api.uploadUnitSegregationPhoto(saved.id, item.container_number, photo.file)
      )));
      const failed = (await Promise.allSettled(uploads)).filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast.error(`${failed} foto(s) não foram enviadas. Abra "Ver detalhes" e bata de novo.`);
      }
      backToList();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="unit-segregation-form-page">
        <PageHeader
          icon={Package}
          title={editingItem ? `Editar segregação #${editingItem.segregation_number}` : 'Nova segregação de unidade'}
          subtitle="Reserva de containers para um cliente específico"
          backTo="/unit-segregation"
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <FormSection title="Cliente" icon={Users}>
              <Field
                label="Cliente reservado"
                required
                hint={formData.client_id ? `Cliente escolhido: ${clientName}` : 'Digite o nome e escolha o cliente na lista'}
                className="max-w-xl"
              >
                <Autocomplete
                  value={clientName}
                  onChange={changeClientText}
                  options={clients}
                  displayField="name"
                  valueField="id"
                  onSelect={selectClient}
                  testId="client-search-input"
                />
              </Field>
            </FormSection>

            <FormSection
              title="Unidades a segregar"
              icon={Container}
              actions={(
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-8 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Adicionar container
                </Button>
              )}
            >
              <div className="space-y-2">
                {formData.items.map((item, index) => (
                  <div key={index} className="flex gap-2 items-start p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex-1 space-y-3 min-w-0">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Field label="Container" required>
                          <Input
                            value={item.container_number}
                            onChange={(e) => updateItem(index, 'container_number', e.target.value)}
                            onBlur={(e) => fillFromEntry(index, e.target.value)}
                            className="h-9 font-mono"
                            disabled={item.photos.length > 0}
                            title={item.photos.length > 0 ? 'Este container já tem foto salva: remova as fotos para trocar o número' : undefined}
                            data-testid={`container-${index}`}
                          />
                        </Field>
                        <Field label="Tara">
                          <Input className="h-9" value={item.tare} onChange={(e) => updateItem(index, 'tare', e.target.value)} data-testid={`tare-${index}`} />
                        </Field>
                        <Field label="Armador" required>
                          <Select value={item.shipping_line} onValueChange={(v) => updateItem(index, 'shipping_line', v)}>
                            <SelectTrigger className="h-9" data-testid={`shipping-${index}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {shippingLines.map((sl) => <SelectItem key={sl.id} value={sl.id}>{sl.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <ContainerPhotos
                        photos={[...item.photos, ...item.staged]}
                        canEdit
                        onAdd={(file) => stagePhoto(index, file)}
                        onRemove={(photo) => removeFormPhoto(index, photo)}
                        onOpen={(i) => openLightbox([...item.photos, ...item.staged], i, item.container_number)}
                        testId={`photo-button-${index}`}
                      />
                    </div>
                    {formData.items.length > 1 && (
                      <Button
                        title="Tirar container" aria-label="Tirar container"
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        className="h-9 w-9 p-0 text-destructive hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-500/10 mt-6"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </FormSection>

            <FormSection title="Observações">
              <Textarea
                rows={3}
                aria-label="Observações"
                value={formData.observations}
                onChange={(e) => setFormData((prev) => ({ ...prev, observations: e.target.value }))}
                data-testid="observations-input"
              />
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>Cancelar</Button>
              <Button type="button" onClick={handleSubmit} disabled={saving} data-testid="segregation-save-btn">
                {saving ? 'Salvando...' : editingItem ? 'Salvar alterações' : 'Criar segregação'}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
      <PhotoLightbox
        photos={lightbox.photos}
        index={lightbox.index}
        onIndexChange={(index) => setLightbox((prev) => ({ ...prev, index }))}
      />
      <ConfirmDialog />
    </Layout>
  );
}
