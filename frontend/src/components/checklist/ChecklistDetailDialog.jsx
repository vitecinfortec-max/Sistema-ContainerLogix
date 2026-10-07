import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarClock, Camera, Check, ChevronDown, CircleDashed, Gauge, Pencil, Printer, ShieldAlert, ShieldCheck,
  User, UserCheck, X, ZoomIn,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { PlateTag } from '../DataPage';
import { motion, Stagger, StaggerItem } from '../Motion';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import ProgressRing from './ProgressRing';
import PhotoLightbox from './PhotoLightbox';
import {
  CHECKLIST_PHOTO_LABELS, CHECKLIST_PHOTO_TYPES, VEHICLE_TYPE_ICONS, VEHICLE_TYPE_LABELS,
  checklistCode, checklistItems, countAnswers, formatKm, resultFromCounts,
} from './checklistShared';

// Detalhes de um checklist do modelo atual: resultado em destaque, o que foi
// reprovado logo no topo, itens por seção e as fotos (clicar amplia).

const PHOTO_ORDER = CHECKLIST_PHOTO_TYPES.map(({ value }) => value);

const RESULT_LOOK = {
  APROVADO: { title: 'Aprovado', Icon: ShieldCheck, ring: 'emerald', band: 'from-emerald-50 dark:from-emerald-500/10', icon: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
  REPROVADO: { title: 'Reprovado', Icon: ShieldAlert, ring: 'red', band: 'from-red-50 dark:from-red-500/10', icon: 'bg-red-500', text: 'text-red-700 dark:text-red-300' },
  PENDENTE: { title: 'Pendente', Icon: CircleDashed, ring: 'slate', band: 'from-slate-100 dark:from-slate-800', icon: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-300' },
};

const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-';
};

function Fact({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
        <p className="break-words text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">{value || '-'}</p>
      </div>
    </div>
  );
}

export default function ChecklistDetailDialog({ open, onOpenChange, checklist, onEdit, onPrint }) {
  const [openSections, setOpenSections] = useState(() => new Set());
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const sections = checklist?.checklist_sections || [];
  const checklistId = checklist?.id || null;
  // Ao abrir: mostra abertas só as seções com item reprovado ou sem resposta
  useEffect(() => {
    if (!open) return;
    setLightboxIndex(null);
    setOpenSections(new Set(sections.map((section, index) => {
      const sectionCounts = countAnswers(section.items || []);
      return sectionCounts.failed > 0 || sectionCounts.pending > 0 ? index : -1;
    }).filter((index) => index >= 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checklistId]);

  if (!checklist) return null;

  const counts = countAnswers(checklistItems(checklist));
  const result = resultFromCounts(counts);
  const look = RESULT_LOOK[result];
  const TypeIcon = VEHICLE_TYPE_ICONS[checklist.vehicle_type];
  const failed = sections.flatMap((section) => (section.items || []).filter((item) => item.answer === 'NAO').map((item) => ({ ...item, section: section.label })));
  const photos = [...(checklist.photos || [])].sort((a, b) => PHOTO_ORDER.indexOf(a.type) - PHOTO_ORDER.indexOf(b.type));
  const lightboxPhotos = photos.map((photo) => ({ id: photo.id, src: api.getFileUrl(photo.url), label: CHECKLIST_PHOTO_LABELS[photo.type] || photo.type }));
  const allOpen = sections.length > 0 && openSections.size === sections.length;
  const toggleSection = (index) => setOpenSections((prev) => {
    const next = new Set(prev);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => { e.preventDefault(); e.currentTarget.focus(); }}
        className="flex h-dvh max-h-dvh w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 outline-none sm:h-auto sm:max-h-[92vh] sm:rounded-xl"
        data-testid="checklist-detail-dialog"
      >
        {/* Topo: resultado em destaque */}
        <div className={cn('border-b border-slate-200 bg-gradient-to-b to-transparent px-4 pb-4 pt-5 dark:border-slate-700 sm:px-6', look.band)}>
          <div className="flex items-center gap-3 pr-8">
            <motion.span
              key={result}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}
              className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-sm', look.icon)}
            >
              <look.Icon className="h-6 w-6" />
            </motion.span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg font-semibold leading-tight">Checklist #{checklist.checklist_number}</DialogTitle>
              <p className={cn('text-sm font-semibold', look.text)} data-testid="checklist-detail-result">{look.title}</p>
            </div>
            <ProgressRing value={counts.total ? counts.answered / counts.total : 0} tone={look.ring} size={52} stroke={5}>
              <span className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{counts.answered}/{counts.total}</span>
            </ProgressRing>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5 font-medium">
              {TypeIcon && <TypeIcon className="h-4 w-4 text-primary" />}
              {VEHICLE_TYPE_LABELS[checklist.vehicle_type] || '-'}
            </span>
            <PlateTag>{checklist.vehicle_plate}</PlateTag>
            <span className="text-xs text-slate-400">{checklistCode(checklist.checklist_number)}</span>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          <Stagger className="grid grid-cols-2 gap-2 md:grid-cols-4" stagger={0.04}>
            <StaggerItem><Fact icon={User} label="Motorista" value={checklist.driver_name} /></StaggerItem>
            <StaggerItem><Fact icon={UserCheck} label="Vistoriador" value={checklist.vistoriador_name} /></StaggerItem>
            <StaggerItem><Fact icon={Gauge} label="Km Atual" value={formatKm(checklist.current_km)} /></StaggerItem>
            <StaggerItem><Fact icon={CalendarClock} label="Data/Hora" value={formatDateTime(checklist.inspection_datetime || checklist.created_at)} /></StaggerItem>
          </Stagger>

          {failed.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10" data-testid="checklist-detail-failed">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                {failed.length} {failed.length > 1 ? 'itens reprovados' : 'item reprovado'}
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {failed.map((item) => (
                  <li key={`${item.section}-${item.text}`} className="flex gap-2 text-sm text-red-900 dark:text-red-100">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    <span>
                      <span className="font-medium">{item.text}</span>
                      <span className="text-red-700/70 dark:text-red-200/60"> · {item.section}</span>
                      {item.note && <span className="block text-[13px] text-red-800/90 dark:text-red-100/80">{item.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sections.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Itens de verificação</h3>
                <button
                  type="button"
                  onClick={() => setOpenSections(allOpen ? new Set() : new Set(sections.map((_, index) => index)))}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {allOpen ? 'Recolher tudo' : 'Expandir tudo'}
                </button>
              </div>
              <div className="space-y-2">
                {sections.map((section, sectionIndex) => {
                  const sectionCounts = countAnswers(section.items || []);
                  const isOpen = openSections.has(sectionIndex);
                  return (
                    <div key={section.label} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => toggleSection(sectionIndex)}
                        className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2.5 text-left dark:bg-slate-800/60"
                      >
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200', isOpen && 'rotate-180')} />
                        <span className="flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{section.label}</span>
                        {sectionCounts.failed > 0 && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                            {sectionCounts.failed} reprovado{sectionCounts.failed > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                          sectionCounts.pending === 0 && sectionCounts.failed === 0
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                        )}>
                          {sectionCounts.ok}/{sectionCounts.total}
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="divide-y divide-slate-100 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                              {(section.items || []).map((item) => (
                                <div key={item.text} className={cn('flex items-start gap-3 px-3 py-2 text-sm', item.answer === 'NAO' && 'bg-red-50/70 dark:bg-red-500/5')}>
                                  <span className="flex-1 text-slate-700 dark:text-slate-200">
                                    {item.text}
                                    {item.answer === 'NAO' && item.note && <span className="block text-xs text-red-700 dark:text-red-300">{item.note}</span>}
                                  </span>
                                  {item.answer === 'SIM' && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" /></span>}
                                  {item.answer === 'NAO' && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-white"><X className="h-3 w-3" /></span>}
                                  {!item.answer && <span className="shrink-0 text-xs text-slate-400">Sem resposta</span>}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <Camera className="h-3.5 w-3.5" /> Fotos ({photos.length})
            </h3>
            {photos.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                Nenhuma foto registrada.
              </p>
            ) : (
              <Stagger className="grid grid-cols-2 gap-2 sm:grid-cols-3" stagger={0.03}>
                {photos.map((photo, index) => (
                  <StaggerItem key={photo.id}>
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(index)}
                      className="group relative block aspect-[4/3] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
                      data-testid="checklist-detail-photo"
                    >
                      <img
                        src={api.getFileUrl(photo.url)}
                        alt={CHECKLIST_PHOTO_LABELS[photo.type] || photo.type}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-[11px] font-medium text-white">
                        {CHECKLIST_PHOTO_LABELS[photo.type] || photo.type}
                        <ZoomIn className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                      </span>
                    </button>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </div>

          {checklist.observations && (
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Observações</h3>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{checklist.observations}</p>
            </div>
          )}

          <p className="text-xs text-slate-400 dark:text-slate-500">
            Registrado por {checklist.created_by_name || '-'} em {formatDateTime(checklist.created_at)}
            {checklist.updated_at ? ` · atualizado em ${formatDateTime(checklist.updated_at)}` : ''}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40 sm:px-6">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="px-2.5">Fechar</Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onEdit(checklist)} className="gap-1.5" data-testid="checklist-detail-edit">
              <Pencil className="h-4 w-4" /> Editar
            </Button>
            <Button type="button" onClick={() => onPrint(checklist)} className="gap-1.5" data-testid="checklist-detail-print">
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
          </div>
        </div>

        <PhotoLightbox photos={lightboxPhotos} index={lightboxIndex} onIndexChange={setLightboxIndex} />
      </DialogContent>
    </Dialog>
  );
}
