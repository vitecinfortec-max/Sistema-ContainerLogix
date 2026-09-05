import { useState } from 'react';
import { Label } from './label';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { cn } from '../../lib/utils';
import { Check, ChevronsUpDown } from 'lucide-react';

function RequiredLabel({ label }) {
  if (typeof label === 'string' && label.endsWith(' *')) {
    return <>{label.slice(0, -2)} <span className="text-red-500">*</span></>;
  }
  return label;
}

export function ComboField({ label, value, onChange, options, emptyLabel = 'Nenhum resultado encontrado', testid }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find(([v]) => v === value);
  return (
    <div>
      {label && <Label className="mb-1 block"><RequiredLabel label={label} /></Label>}
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(''); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open}
            className="w-full justify-between font-normal h-9 text-sm" data-testid={testid}>
            <span className="truncate">{selected ? selected[1] : ''}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput value={search} onValueChange={setSearch} />
            <CommandList>
              {search.trim().length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Digite para buscar...</div>
              ) : (
                <>
                  <CommandEmpty>{emptyLabel}</CommandEmpty>
                  <CommandGroup>
                    {options.map(([v, l]) => (
                      <CommandItem key={v} value={l} onSelect={() => { onChange(v); setOpen(false); setSearch(''); }}>
                        <Check className={cn('mr-2 h-4 w-4', value === v ? 'opacity-100' : 'opacity-0')} />
                        {l}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
