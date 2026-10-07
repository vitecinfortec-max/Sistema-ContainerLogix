import { AnimatePresence } from 'motion/react';
import { Camera, Check, Rotate3d } from 'lucide-react';
import Stage3D from '../three/Stage3D';
import { vehicleScene } from '../three/vehicleScene';
import { motion } from '../Motion';
import { cn } from '../../lib/utils';
import { VEHICLE_TYPE_LABELS } from './checklistShared';

// Onde cada posição de foto fica no desenho de cima do veículo (versão 2D,
// usada quando o navegador não tem WebGL). A frente aponta pra direita.
const DIAGRAM_SPOTS = {
  front: { x: 276, y: 80, label: 'Frente', lx: 276, ly: 106 },
  back: { x: 44, y: 80, label: 'Traseira', lx: 44, ly: 106 },
  left_side: { x: 160, y: 26, label: 'Lateral esquerda', lx: 160, ly: 14 },
  right_side: { x: 160, y: 134, label: 'Lateral direita', lx: 160, ly: 153 },
  speedometer: { x: 214, y: 68, label: 'Painel', lx: 214, ly: 54 },
  tires: { x: 104, y: 48, label: 'Pneus', lx: 104, ly: 36 },
};

function VehicleDiagram({ slots, active, doneTypes }) {
  return (
    <svg viewBox="0 0 320 160" className="absolute inset-x-0 top-1 h-[76%] w-full" role="img" aria-label="Posições das fotos no veículo" data-testid="checklist-photo-guide-2d">
      {/* Rodas, carroceria e cabine vistas de cima */}
      {[[92, 44], [92, 108], [226, 44], [226, 108]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="26" height="8" rx="3" className="fill-slate-500 dark:fill-slate-400" />
      ))}
      <rect x="70" y="50" width="186" height="60" rx="12" className="fill-white stroke-slate-300 dark:fill-slate-700 dark:stroke-slate-500" strokeWidth="1.5" />
      <rect x="196" y="56" width="34" height="48" rx="6" className="fill-slate-200 dark:fill-slate-600" />
      <path d="M 236 58 Q 250 80 236 102" fill="none" className="stroke-slate-300 dark:stroke-slate-500" strokeWidth="1.5" />
      {slots.map(({ value }) => {
        const spot = DIAGRAM_SPOTS[value];
        if (!spot) return null;
        const done = doneTypes.has(value);
        const isActive = value === active;
        return (
          <g key={value}>
            {isActive && (
              <circle cx={spot.x} cy={spot.y} r="9" className="animate-ping fill-primary/50" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
            )}
            <circle
              cx={spot.x}
              cy={spot.y}
              r="9"
              strokeWidth="1.5"
              className={cn(
                done ? 'fill-emerald-500 stroke-emerald-600' : isActive ? 'fill-primary stroke-primary' : 'fill-white stroke-slate-400 dark:fill-slate-800 dark:stroke-slate-500',
              )}
            />
            {done && <path d={`M ${spot.x - 4} ${spot.y} l 3 3 l 5 -6`} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
            <text x={spot.lx} y={spot.ly} textAnchor="middle" className={cn('text-[9px]', isActive ? 'fill-primary font-semibold' : 'fill-slate-500 dark:fill-slate-400')}>
              {spot.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Guia das fotos: o veículo em 3D girando até o ângulo da foto pedida, dentro
 * de uma moldura de visor de câmera. `slots` são as posições (photoSlotsFor),
 * `active` a posição da vez e `doneTypes` (Set) as que já têm foto.
 */
export default function VehiclePhotoGuide({ vehicleType, slots, active, doneTypes, className }) {
  const slot = slots.find((s) => s.value === active) || null;
  const done = !!slot && doneTypes.has(slot.value);
  const complete = slots.length > 0 && slots.every((s) => doneTypes.has(s.value));
  const diagram = <VehicleDiagram slots={slots} active={active} doneTypes={doneTypes} />;

  return (
    <div
      className={cn(
        'group relative h-52 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-slate-200/70 sm:h-60',
        'dark:border-slate-700 dark:from-slate-900 dark:to-slate-800',
        className,
      )}
      data-testid="checklist-photo-guide"
    >
      <Stage3D
        key={vehicleType}
        scene={vehicleScene}
        params={{ type: vehicleType, active, complete }}
        className="absolute inset-0"
        fallback={diagram}
        startDelay={250}
        ariaLabel={`${VEHICLE_TYPE_LABELS[vehicleType] || 'Veículo'} em 3D mostrando o ângulo da foto`}
        testId="checklist-photo-guide-3d"
      />

      {/* Cantos do visor */}
      <div className="pointer-events-none absolute inset-3">
        {['left-0 top-0 border-l-2 border-t-2 rounded-tl-md', 'right-0 top-0 border-r-2 border-t-2 rounded-tr-md', 'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-md', 'right-0 bottom-0 border-r-2 border-b-2 rounded-br-md'].map((corner) => (
          <span key={corner} className={cn('absolute h-4 w-4 transition-colors duration-300', done ? 'border-emerald-500' : 'border-primary/70', corner)} />
        ))}
      </div>

      <div className="pointer-events-none absolute left-5 top-5 right-5 flex items-start justify-between gap-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={`${slot?.value || 'geral'}-${done}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16 }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm',
              done ? 'bg-emerald-600' : 'bg-primary',
            )}
          >
            {done ? <Check className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
            {slot ? slot.label : 'Visão geral'}
          </motion.span>
        </AnimatePresence>
        <span className="hidden items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[10px] font-medium text-slate-500 shadow-sm backdrop-blur group-has-[[data-stage=ready]]:inline-flex motion-reduce:!hidden dark:bg-slate-900/70 dark:text-slate-300">
          <Rotate3d className="h-3 w-3" />
          Arraste para girar
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white/95 via-white/70 to-transparent px-5 pb-4 pt-6 dark:from-slate-900/95 dark:via-slate-900/70">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={`${slot?.value || 'geral'}-${done}-${complete}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="text-center text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            {!slot
              ? (complete ? 'Todas as posições foram fotografadas.' : 'Escolha uma posição para ver o enquadramento.')
              : done ? 'Foto registrada. Você pode tirar outra desta posição.' : slot.hint}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
