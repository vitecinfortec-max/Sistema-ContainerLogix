import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Search, Container, UserRound, Building2, Users, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

const DATA_ICONS = {
  container: Container,
  driver: UserRound,
  client: Users,
  company: Building2,
};

const GROUP_LABELS = {
  page: 'Páginas',
  container: 'Contêineres',
  driver: 'Motoristas',
  client: 'Clientes',
  company: 'Transportadoras',
};

const GROUP_ORDER = ['container', 'driver', 'client', 'company', 'page'];

export default function CommandPalette({ open, onOpenChange, items }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dataResults, setDataResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setDataResults([]);
      // Radix já move o foco para o conteúdo do modal; garantimos o input em seguida
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const term = query.trim();
    if (term.length < 2) {
      setDataResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const response = await api.globalSearch(term);
        if (requestId === requestIdRef.current) {
          setDataResults(response.data.results || []);
        }
      } catch (error) {
        if (requestId === requestIdRef.current) setDataResults([]);
      } finally {
        if (requestId === requestIdRef.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const pageResults = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [query, items]);

  const groupedResults = useMemo(() => {
    const byType = {};
    for (const r of dataResults) {
      if (!byType[r.type]) byType[r.type] = [];
      byType[r.type].push({ ...r, kind: 'data' });
    }
    if (pageResults.length > 0) {
      byType.page = pageResults.map((item) => ({ ...item, kind: 'page' }));
    }
    return GROUP_ORDER
      .filter((type) => byType[type]?.length)
      .map((type) => ({ type, label: GROUP_LABELS[type], entries: byType[type] }));
  }, [dataResults, pageResults]);

  const flatResults = useMemo(() => groupedResults.flatMap((g) => g.entries), [groupedResults]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, dataResults]);

  const goTo = (path) => {
    navigate(path);
    onOpenChange(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatResults[selectedIndex];
      if (item) goTo(item.path);
    }
  };

  let runningIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[15%] translate-y-0 max-w-lg p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Busca global</DialogTitle>
        <div className="flex items-center gap-3 px-4 border-b border-slate-200 dark:border-slate-700">
          {searching ? (
            <Loader2 className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0 animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar contêiner, motorista, cliente, página..."
            className="w-full h-12 text-sm bg-transparent focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
            data-testid="command-palette-input"
          />
          <kbd className="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 flex-shrink-0">Esc</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto py-1">
          {flatResults.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500 text-center">
              {searching ? 'Buscando...' : 'Nenhum resultado'}
            </p>
          ) : (
            groupedResults.map((group) => (
              <div key={group.type}>
                <p className="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.label}
                </p>
                {group.entries.map((item) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const Icon = item.kind === 'page' ? item.icon : DATA_ICONS[item.type];
                  return (
                    <button
                      key={`${item.type}-${item.path}-${item.label}`}
                      onClick={() => goTo(item.path)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                        index === selectedIndex ? 'bg-primary/10 text-primary' : 'text-slate-700 dark:text-slate-300'
                      }`}
                      data-testid={`command-palette-item-${item.type}-${item.label}`}
                    >
                      {Icon && <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />}
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{item.label}</span>
                        {item.subtitle && (
                          <span className="block truncate text-xs text-slate-400 dark:text-slate-500">{item.subtitle}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
