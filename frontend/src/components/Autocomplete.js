import { useEffect, useRef, useState } from 'react';
import { Input } from './ui/input';

// Componente de autocomplete genérico - antes copiado de forma idêntica em
// LoadingSchedulePage, DailyRateRequestPage, ExpenseReportsPage e
// VehicleChecklistPage (4 cópias, ~75 linhas cada). Consolidado aqui para que
// uma correção futura valha para todas as telas de uma vez.
export function Autocomplete({ value, onChange, options, displayField = 'name', valueField = 'id', onSelect, className = '' }) {
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
      <Input
        className={`h-9 ${className}`}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
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

export default Autocomplete;
