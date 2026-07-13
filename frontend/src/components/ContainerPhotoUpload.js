import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Camera, X, Loader2, ZoomIn, Download, Image as ImageIcon, AlertCircle, RefreshCw, ClipboardCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

const PHOTO_POSITIONS = [
  { key: 'frente', label: 'Frente', description: 'Foto da frente do container' },
  { key: 'traseira', label: 'Traseira', description: 'Foto da traseira do container' },
  { key: 'esquerda', label: 'Lado Esquerdo', description: 'Foto do lado esquerdo' },
  { key: 'direita', label: 'Lado Direito', description: 'Foto do lado direito' },
];

// Opções do checklist de vistoria. "SEM_AVARIA" é exclusiva com as demais.
export const DAMAGE_OPTIONS = [
  { key: 'SEM_AVARIA', label: 'Sem Avaria' },
  { key: 'AMASSADO', label: 'Amassado' },
  { key: 'FURADO', label: 'Furado/Perfurado' },
  { key: 'VAZAMENTO', label: 'Vazamento' },
  { key: 'ESTRUTURA_COMPROMETIDA', label: 'Estrutura Comprometida' },
  { key: 'PISO_DANIFICADO', label: 'Piso Danificado' },
  { key: 'PORTAS_DANIFICADAS', label: 'Portas Danificadas' },
  { key: 'SUJEIRA_RESIDUOS', label: 'Sujeira/Resíduos' },
  { key: 'LACRE_VIOLADO', label: 'Lacre Violado' },
];

export const DAMAGE_LABELS = DAMAGE_OPTIONS.reduce((acc, { key, label }) => {
  acc[key] = label;
  return acc;
}, {});

// Estados possíveis para cada slot de foto
const SLOT_STATES = {
  EMPTY: 'empty',
  UPLOADING: 'uploading',
  SUCCESS: 'success',
  ERROR: 'error',
};

// Construir a URL completa da foto
const buildPhotoUrl = (path) => {
  if (!path) return null;
  
  // Se a URL já for completa (http/https), retornar como está
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  // Se for um blob URL (preview local), retornar como está
  if (path.startsWith('blob:')) {
    return path;
  }
  
  // Extrair apenas o nome do arquivo da URL
  const filename = path.split('/').pop();
  
  // Construir URL completa usando a variável de ambiente
  const baseUrl = process.env.REACT_APP_BACKEND_URL || '';
  return `${baseUrl}/api/uploads/${filename}`;
};

export default function ContainerPhotoUpload({ photos, onChange, damages = [], onDamagesChange, disabled = false }) {
  const toggleDamage = useCallback((key) => {
    if (!onDamagesChange) return;

    if (key === 'SEM_AVARIA') {
      onDamagesChange(damages.includes('SEM_AVARIA') ? [] : ['SEM_AVARIA']);
      return;
    }

    const withoutSemAvaria = damages.filter((d) => d !== 'SEM_AVARIA');
    if (withoutSemAvaria.includes(key)) {
      onDamagesChange(withoutSemAvaria.filter((d) => d !== key));
    } else {
      onDamagesChange([...withoutSemAvaria, key]);
    }
  }, [damages, onDamagesChange]);

  // Estado unificado para cada slot: { state, url, localPreview }
  const [slots, setSlots] = useState(() => {
    const initial = {};
    PHOTO_POSITIONS.forEach(({ key }) => {
      const existingUrl = photos?.[key];
      initial[key] = {
        state: existingUrl ? SLOT_STATES.SUCCESS : SLOT_STATES.EMPTY,
        url: existingUrl || null,
        localPreview: null,
      };
    });
    return initial;
  });
  
  const [previewImage, setPreviewImage] = useState(null);
  const fileInputRefs = useRef({});

  // Sincronizar quando props.photos mudar externamente
  useEffect(() => {
    setSlots(prev => {
      const updated = { ...prev };
      PHOTO_POSITIONS.forEach(({ key }) => {
        const externalUrl = photos?.[key];
        const currentSlot = prev[key];
        
        // Só atualizar se houver mudança real e não estiver em upload
        if (currentSlot.state !== SLOT_STATES.UPLOADING) {
          if (externalUrl && currentSlot.url !== externalUrl) {
            updated[key] = {
              state: SLOT_STATES.SUCCESS,
              url: externalUrl,
              localPreview: null,
            };
          } else if (!externalUrl && currentSlot.state === SLOT_STATES.SUCCESS) {
            updated[key] = {
              state: SLOT_STATES.EMPTY,
              url: null,
              localPreview: null,
            };
          }
        }
      });
      return updated;
    });
  }, [photos]);

  const handleFileSelect = useCallback(async (position, file) => {
    if (!file) return;
    
    // Validar tipo
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Tipo de arquivo não permitido. Use JPG, PNG ou WebP.');
      return;
    }
    
    // Validar tamanho (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo: 10MB');
      return;
    }

    // Criar preview local imediato
    const localPreviewUrl = URL.createObjectURL(file);
    
    // Marcar slot como "uploading" com preview local
    setSlots(prev => ({
      ...prev,
      [position]: {
        state: SLOT_STATES.UPLOADING,
        url: null,
        localPreview: localPreviewUrl,
      }
    }));
    
    try {
      console.log(`[Upload] Iniciando upload para ${position}:`, file.name, file.size);
      
      const response = await api.uploadFile(file);
      const { url, filename } = response.data;
      
      console.log(`[Upload] Sucesso! ${position}:`, { url, filename });
      
      // Revogar preview local
      URL.revokeObjectURL(localPreviewUrl);
      
      // Atualizar slot para SUCCESS com URL do servidor
      setSlots(prev => ({
        ...prev,
        [position]: {
          state: SLOT_STATES.SUCCESS,
          url: url,
          localPreview: null,
        }
      }));
      
      // Notificar componente pai
      const newPhotos = { ...photos, [position]: url };
      onChange(newPhotos);
      
      toast.success(`Foto ${PHOTO_POSITIONS.find(p => p.key === position)?.label || position} enviada!`);
    } catch (error) {
      console.error(`[Upload] Erro ao fazer upload (${position}):`, error);
      
      // Revogar preview local
      URL.revokeObjectURL(localPreviewUrl);
      
      // Marcar slot como ERROR
      setSlots(prev => ({
        ...prev,
        [position]: {
          state: SLOT_STATES.ERROR,
          url: null,
          localPreview: null,
        }
      }));
      
      toast.error(error.response?.data?.detail || 'Erro ao enviar foto. Tente novamente.');
    }
  }, [photos, onChange]);

  const handleRemovePhoto = useCallback((position) => {
    const slot = slots[position];
    
    // Revogar preview local se existir
    if (slot.localPreview) {
      URL.revokeObjectURL(slot.localPreview);
    }
    
    // Resetar slot
    setSlots(prev => ({
      ...prev,
      [position]: {
        state: SLOT_STATES.EMPTY,
        url: null,
        localPreview: null,
      }
    }));
    
    // Notificar componente pai
    const newPhotos = { ...photos };
    delete newPhotos[position];
    onChange(Object.keys(newPhotos).length > 0 ? newPhotos : null);
    
    // Tentar deletar do servidor (não bloqueia se falhar)
    if (slot.url) {
      const filename = slot.url.split('/').pop();
      api.deleteFile(filename).catch(err => {
        console.log('Arquivo pode já ter sido removido:', err);
      });
    }
    
    toast.success('Foto removida!');
  }, [slots, photos, onChange]);

  const handleImageError = useCallback((position) => {
    console.error(`[Erro] Falha ao carregar imagem: ${position}`);
    setSlots(prev => ({
      ...prev,
      [position]: {
        ...prev[position],
        state: SLOT_STATES.ERROR,
      }
    }));
  }, []);

  const handleDownload = (url, label) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `container_${label.toLowerCase().replace(/\s+/g, '_')}.jpg`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const triggerFileInput = (position, useCamera = false) => {
    const input = fileInputRefs.current[position];
    if (input) {
      if (useCamera) {
        input.setAttribute('capture', 'environment');
      } else {
        input.removeAttribute('capture');
      }
      input.click();
    }
  };

  const handleRetry = useCallback((position) => {
    // Resetar para tentar novamente
    setSlots(prev => ({
      ...prev,
      [position]: {
        state: SLOT_STATES.EMPTY,
        url: null,
        localPreview: null,
      }
    }));
  }, []);

  // Obter a URL para exibição baseada no estado do slot
  const getDisplayUrl = (position) => {
    const slot = slots[position];
    
    // Se tiver preview local (durante upload), usar ele
    if (slot.localPreview) {
      return slot.localPreview;
    }
    
    // Se tiver URL do servidor, construir URL completa
    if (slot.url) {
      return buildPhotoUrl(slot.url);
    }
    
    return null;
  };

  // Contar fotos válidas
  const validPhotosCount = Object.values(slots).filter(
    slot => slot.state === SLOT_STATES.SUCCESS && slot.url
  ).length;

  return (
    <>
      <Card>
        <CardHeader className="bg-slate-50">
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5" />
            Vistoria de Container
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="mb-6">
            <Label className="text-sm font-medium mb-2 block">Estado do Container</Label>
            <p className="text-sm text-muted-foreground mb-3">
              Marque "Sem Avaria" se o container não apresentar nenhum problema, ou selecione as avarias constatadas.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {DAMAGE_OPTIONS.map(({ key, label }) => (
                <label
                  key={key}
                  className={`flex items-center gap-2 text-sm cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${key === 'SEM_AVARIA' ? 'font-semibold' : ''}`}
                  data-testid={`damage-option-${key}`}
                >
                  <Checkbox
                    checked={damages.includes(key)}
                    onCheckedChange={() => toggleDamage(key)}
                    disabled={disabled || (key !== 'SEM_AVARIA' && damages.includes('SEM_AVARIA'))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <Label className="text-sm font-medium mb-2 block">Fotos do Container (Opcional)</Label>
          <p className="text-sm text-muted-foreground mb-4">
            Você pode adicionar até 4 fotos do container (uma de cada lado). Formatos aceitos: JPG, PNG, WebP. Tamanho máximo: 10MB por foto.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {PHOTO_POSITIONS.map(({ key, label, description }) => {
              const slot = slots[key];
              const displayUrl = getDisplayUrl(key);
              const isUploading = slot.state === SLOT_STATES.UPLOADING;
              const isSuccess = slot.state === SLOT_STATES.SUCCESS;
              const isError = slot.state === SLOT_STATES.ERROR;
              const isEmpty = slot.state === SLOT_STATES.EMPTY;
              
              return (
                <div key={key} className="space-y-2">
                  <Label className="text-sm font-medium">{label}</Label>
                  
                  <div 
                    className={`
                      relative aspect-square rounded-lg border-2 border-dashed 
                      ${isSuccess ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 bg-muted/50'}
                      ${isError ? 'border-destructive bg-destructive/5' : ''}
                      ${isUploading ? 'border-primary/50 bg-primary/5' : ''}
                      ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                      transition-colors overflow-hidden
                    `}
                    data-testid={`photo-upload-${key}`}
                  >
                    {/* Input de arquivo oculto */}
                    <input
                      ref={el => fileInputRefs.current[key] = el}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(key, file);
                        e.target.value = '';
                      }}
                      disabled={disabled || isUploading}
                      data-testid={`photo-input-${key}`}
                    />

                    {isUploading ? (
                      <>
                        {/* Mostrar preview local durante upload */}
                        {displayUrl && (
                          <img 
                            src={displayUrl} 
                            alt={label}
                            className="w-full h-full object-cover opacity-50"
                          />
                        )}
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60">
                          <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                          <span className="text-xs text-muted-foreground font-medium">Enviando...</span>
                        </div>
                      </>
                    ) : isSuccess && displayUrl ? (
                      <>
                        <img 
                          src={displayUrl} 
                          alt={label}
                          className="w-full h-full object-cover"
                          onError={() => handleImageError(key)}
                        />
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewImage({ url: displayUrl, label });
                            }}
                            disabled={disabled}
                            data-testid={`photo-preview-${key}`}
                          >
                            <ZoomIn className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="destructive"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemovePhoto(key);
                            }}
                            disabled={disabled}
                            data-testid={`photo-remove-${key}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </>
                    ) : isError ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                        <AlertCircle className="w-6 h-6 text-destructive mb-1" />
                        <span className="text-xs text-destructive text-center mb-2">Erro ao carregar</span>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-2"
                            onClick={() => handleRetry(key)}
                          >
                            <RefreshCw className="w-3 h-3 mr-1" />
                            Tentar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-2"
                            onClick={() => triggerFileInput(key, false)}
                          >
                            Reenviar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                        <ImageIcon className="w-8 h-8 text-muted-foreground/50 mb-2" />
                        <span className="text-xs text-muted-foreground text-center mb-3">
                          {description}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            onClick={() => triggerFileInput(key, true)}
                            disabled={disabled}
                          >
                            <Camera className="w-3 h-3 mr-1" />
                            Câmera
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            onClick={() => triggerFileInput(key, false)}
                            disabled={disabled}
                          >
                            <ImageIcon className="w-3 h-3 mr-1" />
                            Galeria
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          {validPhotosCount > 0 && (
            <p className="text-xs text-muted-foreground mt-4">
              {validPhotosCount} de 4 fotos adicionadas
            </p>
          )}
        </CardContent>
      </Card>

      {/* Modal de visualização */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{previewImage?.label}</span>
              {previewImage && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(previewImage.url, previewImage.label)}
                  data-testid="download-photo-btn"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Baixar Foto
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center">
            {previewImage && (
              <img 
                src={previewImage.url} 
                alt={previewImage.label}
                className="max-h-[70vh] object-contain rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
