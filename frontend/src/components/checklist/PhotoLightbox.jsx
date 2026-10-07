import { useCallback, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { motion } from '../Motion';

/**
 * Foto ampliada, com as setas (do teclado também) pra passar pelas outras.
 * `photos`: [{ id, src, label }]; `index`: a foto aberta, ou null pra fechar.
 */
export default function PhotoLightbox({ photos, index, onIndexChange }) {
  const open = index !== null && index !== undefined && !!photos[index];
  const count = photos.length;
  const step = useCallback((delta) => {
    if (!open || count < 2) return;
    onIndexChange((index + delta + count) % count);
  }, [open, count, index, onIndexChange]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  const photo = open ? photos[index] : null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onIndexChange(null); }}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => { e.preventDefault(); e.currentTarget.focus(); }}
        className="outline-none max-w-5xl w-[calc(100vw-1.5rem)] gap-0 border-0 bg-slate-950 p-0 text-white sm:rounded-xl overflow-hidden"
        data-testid="photo-lightbox"
      >
        <DialogTitle className="sr-only">{photo?.label || 'Foto'}</DialogTitle>
        <div className="relative flex h-[min(78vh,720px)] items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {photo && (
              <motion.img
                key={photo.id}
                src={photo.src}
                alt={photo.label}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="max-h-full max-w-full object-contain"
              />
            )}
          </AnimatePresence>
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Foto anterior"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/25"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Próxima foto"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/25"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5 text-sm">
          <span className="font-medium">{photo?.label}</span>
          <span className="tabular-nums text-white/60">{open ? index + 1 : 0} de {count}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
