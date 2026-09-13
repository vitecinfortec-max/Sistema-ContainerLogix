import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Autocomplete } from './Autocomplete';
import { ClipboardCheck, X, Camera, Upload, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { compressImage } from '../lib/imageCompression';
import { CONTAINER_INSPECTION_PHOTO_TYPES } from '../pages/NewContainerInspectionPage';

// Labels dos códigos antigos de avaria (checklist fixa, substituída pela busca
// de Tipo de Serviços de reparo) - mantido só pra vistorias antigas já
// gravadas com esses códigos continuarem exibindo um texto legível (MovementDetailPage
// e o comprovante em backend/reports.py usam esse fallback via `DAMAGE_LABELS[d] || d`).
export const DAMAGE_LABELS = {
  SEM_AVARIA: 'Sem Avaria',
  AMASSADO: 'Amassado',
  FURADO: 'Furado/Perfurado',
  VAZAMENTO: 'Vazamento',
  ESTRUTURA_COMPROMETIDA: 'Estrutura Comprometida',
  PISO_DANIFICADO: 'Piso Danificado',
  PORTAS_DANIFICADAS: 'Portas Danificadas',
  SUJEIRA_RESIDUOS: 'Sujeira/Resíduos',
  LACRE_VIOLADO: 'Lacre Violado',
};

export const MAX_MOVEMENT_VISTORIA_PHOTOS = 12;

const PHOTO_TYPE_LABELS = CONTAINER_INSPECTION_PHOTO_TYPES.reduce((acc, { value, label }) => {
  acc[value] = label;
  return acc;
}, {});

const INFO_FIELDS = [
  { label: 'Número do Container', key: 'container_number' },
  { label: 'Cliente', key: 'client_name' },
  { label: 'Armador', key: 'shipping_line' },
  { label: 'Placa do Cavalo', key: 'truck_plate' },
  { label: 'Carreta', key: 'trailer_plate_1' },
  { label: 'Transportadora', key: 'transport_company' },
  { label: 'Tamanho/Tipo', key: 'size_type' },
  { label: 'Tara', key: 'tare' },
];

export default function ContainerPhotoUpload({
  damages = [], onDamagesChange, notes = '', onNotesChange, disabled = false, movementInfo = {},
  photos = [], onAddPhoto, onRemovePhoto, uploadingPhoto = false,
}) {
  const [repairServices, setRepairServices] = useState([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [newPhotoType, setNewPhotoType] = useState('front');
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.getContainerRepairServices()
      .then((res) => setRepairServices(res.data || []))
      .catch(() => {});
  }, []);

  const noDamage = damages.includes('SEM_AVARIA');
  const selectedServices = damages.filter((d) => d !== 'SEM_AVARIA');

  const toggleNoDamage = (checked) => {
    if (!onDamagesChange) return;
    onDamagesChange(checked ? ['SEM_AVARIA'] : []);
  };

  const addService = (service) => {
    if (!onDamagesChange || !service?.name) return;
    if (!selectedServices.includes(service.name)) {
      onDamagesChange([...selectedServices, service.name]);
    }
    setServiceSearch('');
  };

  const removeService = (name) => {
    if (!onDamagesChange) return;
    onDamagesChange(selectedServices.filter((s) => s !== name));
  };

  const triggerFileInput = (useCamera) => {
    const input = fileInputRef.current;
    if (!input) return;
    if (useCamera) {
      input.setAttribute('capture', 'environment');
    } else {
      input.removeAttribute('capture');
    }
    input.click();
  };

  const handleFileSelected = async (file) => {
    if (!file || !onAddPhoto) return;
    if (photos.length >= MAX_MOVEMENT_VISTORIA_PHOTOS) return;
    const compressed = await compressImage(file);
    onAddPhoto(newPhotoType, compressed);
  };

  return (
    <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
      <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
        <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4" />
          Vistoria de Container
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {INFO_FIELDS.map(({ label, key }) => (
            <div key={key}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold">{movementInfo?.[key] || '-'}</p>
            </div>
          ))}
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Checkbox
              id="no_damage"
              checked={noDamage}
              onCheckedChange={toggleNoDamage}
              disabled={disabled}
            />
            <Label htmlFor="no_damage" className="cursor-pointer font-semibold">Sem Avarias</Label>
          </div>

          {!noDamage && (
            <div>
              <Label className="text-sm font-medium mb-2 block">Tipo de Serviços</Label>
              <p className="text-sm text-muted-foreground mb-3">
                Busque e adicione os serviços de reparo constatados na vistoria.
              </p>
              <Autocomplete
                value={serviceSearch}
                onChange={setServiceSearch}
                onSelect={addService}
                options={repairServices}
                displayField="name"
                className={disabled ? 'opacity-50 cursor-not-allowed' : ''}
              />
              {selectedServices.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {selectedServices.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-800 font-semibold text-sm"
                    >
                      {name}
                      {!disabled && (
                        <button type="button" onClick={() => removeService(name)} data-testid={`remove-service-${name}`}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {onAddPhoto && (
          <div className="mb-6">
            <Label className="text-sm font-medium mb-2 block">Fotos da Vistoria ({photos.length}/{MAX_MOVEMENT_VISTORIA_PHOTOS})</Label>
            <p className="text-sm text-muted-foreground mb-3">
              Anexe até {MAX_MOVEMENT_VISTORIA_PHOTOS} fotos (Frente, Traseira, Laterais, Interno).
            </p>
            <div className="flex flex-wrap items-end gap-2 mb-4">
              <div className="w-48">
                <Label htmlFor="new_vistoria_photo_type" className="text-xs mb-1 block">Tipo da foto</Label>
                <Select value={newPhotoType} onValueChange={setNewPhotoType} disabled={disabled}>
                  <SelectTrigger id="new_vistoria_photo_type" data-testid="new-vistoria-photo-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTAINER_INSPECTION_PHOTO_TYPES.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => triggerFileInput(true)}
                disabled={disabled || uploadingPhoto || photos.length >= MAX_MOVEMENT_VISTORIA_PHOTOS}
                data-testid="vistoria-photo-camera-btn"
              >
                {uploadingPhoto ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                Câmera
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => triggerFileInput(false)}
                disabled={disabled || uploadingPhoto || photos.length >= MAX_MOVEMENT_VISTORIA_PHOTOS}
                data-testid="vistoria-photo-gallery-btn"
              >
                <Upload className="w-4 h-4 mr-2" />
                Galeria
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleFileSelected(e.target.files?.[0]);
                  e.target.value = '';
                }}
                data-testid="vistoria-photo-input"
              />
            </div>

            {photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {photos.map((photo) => (
                  <div key={photo.id} className="border rounded-lg overflow-hidden">
                    <div className="px-2 py-1 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-center border-b">
                      {PHOTO_TYPE_LABELS[photo.type] || photo.type}
                    </div>
                    <div className="relative">
                      <img
                        src={photo.previewUrl || api.getFileUrl(photo.url)}
                        alt={PHOTO_TYPE_LABELS[photo.type] || photo.type}
                        className="w-full h-28 object-cover"
                      />
                      {!disabled && onRemovePhoto && (
                        <button
                          type="button"
                          onClick={() => onRemovePhoto(photo.id)}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 rounded-full p-1"
                          data-testid={`remove-vistoria-photo-${photo.id}`}
                        >
                          <X className="w-3.5 h-3.5 text-white" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="inspection_notes" className="text-sm font-medium mb-2 block">Observações da Vistoria</Label>
          <Textarea
            id="inspection_notes"
            data-testid="inspection-notes-input"
            value={notes}
            onChange={(e) => onNotesChange?.(e.target.value)}
            disabled={disabled}
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  );
}
