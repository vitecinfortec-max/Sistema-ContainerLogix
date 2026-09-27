import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from './ui/input';
import { Search } from 'lucide-react';

// Componente de autocomplete genérico - antes copiado de forma idêntica em
// LoadingSchedulePage, DailyRateRequestPage, ExpenseReportsPage e
// VehicleChecklistPage (4 cópias, ~75 linhas cada). Consolidado aqui para que
// uma correção futura valha para todas as telas de uma vez.
export function Autocomplete({ value, onChange, options, displayField = 'name', valueField = 'id', onSelect, className = '', testId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');
  const [filteredOptions, setFilteredOptions] = useState([]);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  useEffect(() => {
    if (inputValue.length > 0) {
      const filtered = options.filter(opt => {
        const display = typeof displayField === 'function' ? displayField(opt) : opt[displayField];
        return display?.toLowerCase().includes(inputValue.toLowerCase());
      });
      setFilteredOptions(filtered.slice(0, 10));
    } else {
      setFilteredOptions(options.slice(0, 10));
    }
  }, [inputValue, options, displayField]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
    setIsOpen(true);
  };

  const handleSelect = (option) => {
    const display = typeof displayField === 'function' ? displayField(option) : option[displayField];
    setInputValue(display);
    onChange(display);
    if (onSelect) onSelect(option);
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <Input
        className={`h-9 pl-8 ${className}`}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        data-testid={testId}
      />
      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border rounded-md shadow-lg max-h-48 overflow-auto">
          {filteredOptions.map((option, idx) => {
            const display = typeof displayField === 'function' ? displayField(option) : option[displayField];
            return (
              <div
                key={option[valueField] || idx}
                className="px-3 py-2 cursor-pointer hover:bg-muted text-sm"
                onClick={() => handleSelect(option)}
              >
                {display}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Autocomplete pra uma lista fixa de opções no formato [[valor, rótulo], ...]
 * (tipo de combustível, categoria, almoxarifado...). O campo mostra o rótulo
 * e devolve o valor em onChange - '' enquanto o texto digitado não bate com
 * nenhuma opção. Substitui o antigo ComboField (lista em popover).
 */
export function OptionAutocomplete({ value, onChange, options, className = '', testId }) {
  const label = options.find(([v]) => v === value)?.[1] || '';
  const [text, setText] = useState(label);
  const ownChange = useRef(false);
  const lastEmitted = useRef(value);

  // Valor trocado de fora (abrir edição, limpar o formulário, opções que
  // chegaram depois): mostra o rótulo correspondente. A troca causada pela
  // própria digitação não mexe no texto, senão o campo se apagaria no meio.
  useEffect(() => {
    if (ownChange.current) {
      ownChange.current = false;
      return;
    }
    lastEmitted.current = value;
    setText(label);
  }, [label, value]);

  // Escolher na lista dispara onChange (texto) e onSelect (opção) em seguida -
  // o mesmo valor só é repassado uma vez.
  const emit = (next) => {
    if (next === lastEmitted.current) return;
    lastEmitted.current = next;
    ownChange.current = true;
    onChange(next);
  };

  const items = useMemo(() => options.map(([v, l]) => ({ value: v, label: l })), [options]);

  return (
    <Autocomplete
      value={text}
      onChange={(t) => {
        setText(t);
        const hit = options.find(([, l]) => l.toLowerCase() === t.trim().toLowerCase());
        emit(hit ? hit[0] : '');
      }}
      onSelect={(o) => emit(o.value)}
      options={items}
      displayField="label"
      valueField="value"
      className={className}
      testId={testId}
    />
  );
}

export default Autocomplete;
