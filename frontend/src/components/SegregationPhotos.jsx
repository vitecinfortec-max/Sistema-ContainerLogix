import { useRef } from 'react';
import { Button } from './ui/button';
import { Camera, Loader2, X } from 'lucide-react';
import { api } from '../lib/api';

// Fotos dos containers da Segregação de Unidade, usadas na lista (detalhes)
// e no formulário (pages/UnitSegregationFormPage)

// Mesmo limite do backend (MAX_PHOTOS_PER_CONTAINER em routers/unit_segregation.py)
export const MAX_PHOTOS_PER_CONTAINER = 6;

export const photoSrc = (photo) => photo.preview || api.getFileUrl(photo.url);

// Miniaturas do container + botão da câmera. `photos`: as já salvas e as que
// ainda serão enviadas ({ preview }); capture="environment" abre a câmera
// traseira no celular.
export function ContainerPhotos({ photos, busy, canEdit, onAdd, onRemove, onOpen, testId }) {
  const inputRef = useRef(null);
  const full = photos.length >= MAX_PHOTOS_PER_CONTAINER;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {photos.map((photo, index) => (
        <div key={photo.id} className="relative">
          <button type="button" title="Ampliar foto" aria-label="Ampliar foto" onClick={() => onOpen(index)} className="block">
            <img src={photoSrc(photo)} alt="Foto do container" className="w-12 h-12 object-cover rounded border border-slate-200 dark:border-slate-700" />
          </button>
          {canEdit && (
            <button
              type="button"
              title="Remover foto"
              aria-label="Remover foto"
              onClick={() => onRemove(photo)}
              disabled={busy}
              className="absolute -top-1.5 -right-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 p-0.5 text-slate-500 hover:text-red-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {canEdit && !full && (
        <>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={busy} onClick={() => inputRef.current?.click()} data-testid={testId}>
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin motion-reduce:animate-none" /> : <Camera className="w-3.5 h-3.5 mr-1" />}
            Bater foto
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onAdd(file);
            }}
          />
        </>
      )}
      {!canEdit && photos.length === 0 && <span className="text-xs text-slate-400 dark:text-slate-500">-</span>}
    </div>
  );
}
