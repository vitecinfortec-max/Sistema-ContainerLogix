import { useEffect, useId, useState } from 'react';

// Teclado e leitor de tela para as listas de sugestão que abrem embaixo de um
// campo (Autocomplete, Cliente/Comprador da EIR): ↓/↑ percorrem as opções,
// Enter escolhe a destacada, Esc fecha. Devolve as props ARIA do campo, da
// lista e de cada opção, no padrão "combobox" do WAI-ARIA.
export function useListKeyboard({ count, open, setOpen, onPick }) {
  const listId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);

  // Lista nova (outro texto digitado) ou fechada: nada destacado
  useEffect(() => { setActiveIndex(-1); }, [count, open]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!count) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => (i + step + count) % count);
    } else if (e.key === 'Enter') {
      // Sem opção destacada o Enter segue normal (ex: enviar o formulário)
      if (open && activeIndex >= 0 && activeIndex < count) {
        e.preventDefault();
        onPick(activeIndex);
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const optionId = (i) => `${listId}-opt-${i}`;

  // Opção destacada pelo teclado sempre visível na lista com rolagem
  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  return {
    activeIndex,
    setActiveIndex,
    inputProps: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': open && count > 0,
      'aria-controls': listId,
      'aria-activedescendant': open && activeIndex >= 0 ? optionId(activeIndex) : undefined,
      autoComplete: 'off',
      onKeyDown,
    },
    listProps: { id: listId, role: 'listbox' },
    optionProps: (i) => ({
      id: optionId(i),
      role: 'option',
      'aria-selected': i === activeIndex,
      'data-active': i === activeIndex || undefined,
      onMouseEnter: () => setActiveIndex(i),
    }),
  };
}

export default useListKeyboard;
