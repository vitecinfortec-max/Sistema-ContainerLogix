import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const LOCKED_CLASS = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-not-allowed';
const LOCKED_HINT = 'Puxado da entrada do container, não pode ser alterado';

// Valor do Container (com moeda) e Data de Fabricação da Emissão/Edição de
// EIR. Opcionais, informados na Entrada; numa Saída, o que a entrada tiver
// preenchido vem em `locked` e o campo fica bloqueado (o backend aplica a
// mesma regra - ver _inherit_from_open_entry em routers/movements.py).
export default function ContainerValueFields({ register, currency, onCurrencyChange, locked = {} }) {
  const valueLocked = locked.container_value !== undefined;
  const dateLocked = locked.manufacture_date !== undefined;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="container_value">Valor do Container</Label>
        <div className="flex gap-2">
          <Select value={currency || 'BRL'} onValueChange={onCurrencyChange} disabled={valueLocked}>
            <SelectTrigger className="h-12 w-24 shrink-0" data-testid="container-value-currency-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BRL">R$</SelectItem>
              <SelectItem value="USD">US$</SelectItem>
            </SelectContent>
          </Select>
          <Input
            id="container_value"
            data-testid="container-value-input"
            type="number"
            step="0.01"
            min="0"
            readOnly={valueLocked}
            {...register('container_value', { valueAsNumber: true })}
            className={`h-12 font-mono ${valueLocked ? LOCKED_CLASS : ''}`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {valueLocked ? LOCKED_HINT : 'Sai apenas no Relatório de Movimentações, não aparece na impressão'}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="manufacture_date">Data de Fabricação</Label>
        <Input
          id="manufacture_date"
          data-testid="manufacture-date-input"
          type="month"
          readOnly={dateLocked}
          {...register('manufacture_date')}
          className={`h-12 font-mono ${dateLocked ? LOCKED_CLASS : ''}`}
        />
        <p className="text-xs text-muted-foreground">
          {dateLocked ? LOCKED_HINT : 'Mês e ano. Sai apenas no Relatório de Movimentações'}
        </p>
      </div>
    </>
  );
}
