import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from './ui/input';
import { useListKeyboard } from '../hooks/useListKeyboard';

// Campo Cliente/Comprador da EIR (nova e editar): digita-se o nome e a lista
// de clientes cadastrados aparece embaixo - só depois do primeiro caractere.
// Antes eram 4 cópias da mesma lista feita à mão, sem teclado; agora ↓/↑,
// Enter e Esc funcionam (ver hooks/useListKeyboard).
// `text` é o que está escrito; `onTextChange` recebe cada digitação e
// `onPick` o cliente escolhido na lista; `onClear` vem do botão X.
export function ClientNamePicker({ id, testId, text, onTextChange, onPick, onClear, clients }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const query = text.toLowerCase();
  const matches = text ? clients.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 10) : [];
  const showList = open && !!text;

  const pick = (client) => {
    onPick(client);
    setOpen(false);
  };

  const { inputProps, listProps, optionProps } = useListKeyboard({
    count: matches.length,
    open: showList,
    setOpen,
    onPick: (i) => pick(matches[i]),
  });

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <Input
          id={id}
          data-testid={testId}
          className="pr-10"
          value={text}
          onChange={(e) => {
            onTextChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          {...inputProps}
        />
        {text && (
          <button
            title="Limpar"
            aria-label="Limpar"
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-400"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {showList && (
        <div {...listProps} className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto">
          {matches.map((client, i) => (
            <div
              key={client.id}
              {...optionProps(i)}
              className="px-4 py-2 cursor-pointer text-sm data-[active]:bg-gray-100 dark:data-[active]:bg-slate-700"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(client);
              }}
            >
              {client.name}
            </div>
          ))}
          {matches.length === 0 && (
            <div className="px-4 py-2 text-sm text-gray-500 dark:text-slate-400">
              Nenhum cliente encontrado
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ClientNamePicker;
