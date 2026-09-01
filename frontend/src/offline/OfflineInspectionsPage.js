import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Plus, Pencil, Trash2, Camera, Upload, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { offlineInspections, offlineClients, offlineShippingLines, newId } from '../lib/offlineDb';
import { SUGGESTED_INSPECTION_ITEMS } from '../lib/inspectionItems';
import { CONTAINER_INSPECTION_PHOTO_TYPES, MAX_CONTAINER_INSPECTION_PHOTOS } from '../pages/NewContainerInspectionPage';
import { capturePhoto, savePhotoBase64, deletePhoto, getPhotoDisplayUri } from '../lib/offlinePhotos';

const PHOTO_LABELS = CONTAINER_INSPECTION_PHOTO_TYPES.reduce((acc, { value, label }) => {
  acc[value] = label;
  return acc;
}, {});

const EMPTY_FORM = {
  id: null,
  container_number: '',
  container_seal: '',
  size_type: '20DC',
  client_name: '',
  shipping_line_name: '',
  observations: '',
  no_damage: false,
  damage_items: [],
};

export default function OfflineInspectionsPage() {
  const [inspections, setInspections] = useState([]);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [photos, setPhotos] = useState([]); // { id, type, relativePath, displayUri }
  const [newPhotoType, setNewPhotoType] = useState('front');
  const [savingPhoto, setSavingPhoto] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [insp, cl, sl] = await Promise.all([
        offlineInspections.list(),
        offlineClients.list(),
        offlineShippingLines.list(),
      ]);
      setInspections(insp);
      setClients(cl);
      setShippingLines(sl);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => {
    setEditing(null);
    setFormData({ ...EMPTY_FORM, id: newId() });
    setPhotos([]);
    setShowForm(true);
  };

  const openEdit = async (insp) => {
    setEditing(insp);
    setFormData({ ...EMPTY_FORM, ...insp });
    const withUris = await Promise.all(
      (insp.photos || []).map(async (p) => ({ ...p, displayUri: await getPhotoDisplayUri(p.url) }))
    );
    setPhotos(withUris);
    setShowForm(true);
  };

  const handleChange = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));

  const toggleDamageItem = (item) => {
    setFormData((prev) => ({
      ...prev,
      damage_items: prev.damage_items.includes(item)
        ? prev.damage_items.filter((i) => i !== item)
        : [...prev.damage_items, item],
    }));
  };

  const handleAddPhoto = async (useCamera) => {
    if (photos.length >= MAX_CONTAINER_INSPECTION_PHOTOS) {
      toast.error(`Máximo de ${MAX_CONTAINER_INSPECTION_PHOTOS} fotos por vistoria`);
      return;
    }
    setSavingPhoto(true);
    try {
      const { base64, ext } = await capturePhoto(useCamera);
      const photoId = newId();
      const relativePath = `container_inspections/${formData.id}/${photoId}.${ext}`;
      await savePhotoBase64(relativePath, base64);
      const displayUri = await getPhotoDisplayUri(relativePath);
      setPhotos((prev) => [...prev, { id: photoId, type: newPhotoType, url: relativePath, displayUri }]);
    } catch (e) {
      // usuário cancelou a captura, ou câmera indisponível — não é um erro a reportar
    } finally {
      setSavingPhoto(false);
    }
  };

  const handleRemovePhoto = async (photoId) => {
    const photo = photos.find((p) => p.id === photoId);
    if (photo) await deletePhoto(photo.url);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  const handleSave = async () => {
    if (!formData.container_number) {
      toast.error('Número do container é obrigatório');
      return;
    }
    try {
      const photosToSave = photos.map(({ id, type, url }) => ({ id, type, url }));
      if (editing) {
        await offlineInspections.update(editing.id, formData);
        await offlineInspections.setPhotos(editing.id, photosToSave);
      } else {
        await offlineInspections.create(formData);
        await offlineInspections.setPhotos(formData.id, photosToSave);
      }
      setShowForm(false);
      load();
      toast.success('Vistoria salva!');
    } catch (e) {
      toast.error('Erro ao salvar vistoria');
    }
  };

  const handleDelete = async (insp) => {
    try {
      for (const photo of insp.photos || []) await deletePhoto(photo.url);
      await offlineInspections.remove(insp.id);
      load();
      toast.success('Removida!');
    } catch (e) {
      toast.error('Erro ao remover');
    }
  };

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-2xl font-bold">Vistoria de Container</h1>

      <Button onClick={openNew} className="w-full" data-testid="inspection-add-btn">
        <Plus className="w-4 h-4 mr-2" />
        Nova Vistoria
      </Button>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
      ) : inspections.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhuma vistoria registrada ainda.</p>
      ) : (
        <div className="space-y-2">
          {inspections.map((insp) => (
            <div key={insp.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">#{insp.inspection_number} — {insp.container_number}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {insp.no_damage ? 'Sem avarias' : `${insp.damage_items.length} avaria(s)`} • {(insp.photos || []).length} foto(s)
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(insp)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(insp)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Vistoria' : 'Nova Vistoria'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Número do Container *</Label>
              <Input
                value={formData.container_number}
                onChange={(e) => handleChange('container_number', e.target.value.toUpperCase())}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Numeração/Lacre</Label>
                <Input value={formData.container_seal} onChange={(e) => handleChange('container_seal', e.target.value.toUpperCase())} />
              </div>
              <div>
                <Label>Tamanho/Tipo</Label>
                <Select value={formData.size_type} onValueChange={(v) => handleChange('size_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['20DC', '20RF', '20OT', '20FR', '40HC', '40RF', '40OT', '40FR', '40DRY'].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Cliente</Label>
              <Select value={formData.client_name || ''} onValueChange={(v) => handleChange('client_name', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Armador</Label>
              <Select value={formData.shipping_line_name || ''} onValueChange={(v) => handleChange('shipping_line_name', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {shippingLines.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="no_damage"
                checked={formData.no_damage}
                onCheckedChange={(checked) => {
                  handleChange('no_damage', checked === true);
                  if (checked) handleChange('damage_items', []);
                }}
              />
              <Label htmlFor="no_damage" className="cursor-pointer font-semibold">Container sem avarias</Label>
            </div>

            {!formData.no_damage && (
              <div className="grid grid-cols-2 gap-2">
                {SUGGESTED_INSPECTION_ITEMS.map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <Checkbox
                      id={`item-${item}`}
                      checked={formData.damage_items.includes(item)}
                      onCheckedChange={() => toggleDamageItem(item)}
                    />
                    <Label htmlFor={`item-${item}`} className="cursor-pointer font-normal text-sm">{item}</Label>
                  </div>
                ))}
              </div>
            )}

            <div>
              <Label>Observações</Label>
              <Textarea value={formData.observations} onChange={(e) => handleChange('observations', e.target.value)} />
            </div>

            <div className="border-t pt-3">
              <Label className="block mb-2">Fotos ({photos.length}/{MAX_CONTAINER_INSPECTION_PHOTOS})</Label>
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <div className="w-40">
                  <Select value={newPhotoType} onValueChange={setNewPhotoType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTAINER_INSPECTION_PHOTO_TYPES.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => handleAddPhoto(true)}
                  disabled={savingPhoto || photos.length >= MAX_CONTAINER_INSPECTION_PHOTOS}
                >
                  {savingPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                </Button>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => handleAddPhoto(false)}
                  disabled={savingPhoto || photos.length >= MAX_CONTAINER_INSPECTION_PHOTOS}
                >
                  <Upload className="w-4 h-4" />
                </Button>
              </div>

              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo) => (
                    <div key={photo.id} className="relative">
                      <img
                        src={photo.displayUri}
                        alt={PHOTO_LABELS[photo.type]}
                        className="w-full h-20 object-cover rounded-lg bg-gray-50"
                      />
                      <Button
                        type="button" variant="destructive" size="icon"
                        className="absolute top-0 right-0 h-5 w-5"
                        onClick={() => handleRemovePhoto(photo.id)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                      <p className="text-[10px] text-center mt-0.5">{PHOTO_LABELS[photo.type]}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
