import { useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Textarea } from './ui/textarea';
import { ClipboardCheck } from 'lucide-react';

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

export default function ContainerPhotoUpload({ damages = [], onDamagesChange, notes = '', onNotesChange, disabled = false }) {
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

  return (
    <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
      <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
        <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4" />
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
