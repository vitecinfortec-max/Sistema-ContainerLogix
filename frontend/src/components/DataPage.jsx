import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../lib/utils';

// Blocos compartilhados das telas de listagem (cabeçalho de filtros,
// indicadores, card da lista com barra de ações, paginação, selos de status).
// O visual de todas as telas sai daqui + das classes .data-table do index.css,
// então um ajuste de estilo feito aqui vale pro sistema inteiro.

const SOFT_TONES = {
  primary: 'bg-primary/10 text-primary',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
};

const ICON_TONES = {
  primary: 'text-primary',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  red: 'text-destructive',
  violet: 'text-violet-600 dark:text-violet-400',
  slate: 'text-slate-600 dark:text-slate-300',
};

const SURFACE = 'rounded-lg border border-slate-200 dark:border-slate-700 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

/** Indicador numérico (KPI) no topo da tela. */
export function StatCard({ label, value, icon: Icon, tone = 'primary', hint, testId }) {
  return (
    <div className={cn(SURFACE, 'p-3 sm:p-4 flex items-center gap-3 min-w-0')} data-testid={testId}>
      {Icon && (
        <div className={cn('hidden sm:flex w-10 h-10 rounded-full items-center justify-center shrink-0', SOFT_TONES[tone] || SOFT_TONES.primary)}>
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{label}</p>
        <p className="text-xl sm:text-2xl font-semibold leading-tight tabular-nums text-slate-900 dark:text-slate-100 truncate">{value}</p>
        {hint && <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{hint}</p>}
      </div>
    </div>
  );
}

export function StatGrid({ children, className }) {
  return <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3', className)}>{children}</div>;
}

/**
 * Card de filtros: título + "Limpar filtros" no topo, campos, e rodapé com
 * Limpar/Filtrar (quando a tela aplica filtros por botão) e/ou ações extras
 * (ex.: Baixar PDF/Excel nas telas de relatório). Telas com filtro ao vivo
 * (sem onApply) mostram só o link "Limpar filtros" do topo.
 */
export function FilterCard({ children, hasFilters, onClear, onApply, actions, title = 'Filtros', clearTestId = 'filter-clear-button', applyTestId = 'filter-apply-button', clearLinkTestId = 'clear-all-filters' }) {
  return (
    <section className={SURFACE}>
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          {title}
          {hasFilters && (
            <span className="rounded-full bg-primary/10 text-primary text-[10px] font-semibold px-1.5 py-px">ativos</span>
          )}
        </span>
        {hasFilters && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-primary flex items-center gap-1"
            data-testid={clearLinkTestId}
          >
            <X className="w-3.5 h-3.5" />
            Limpar filtros
          </button>
        )}
      </div>
      <div className="p-4">
        {children}
        {(onApply || actions) && (
          <div className="flex items-center justify-end gap-2 mt-3 flex-wrap">
            {onClear && onApply && (
              <Button type="button" variant="outline" size="sm" onClick={onClear} className="h-8 text-xs" data-testid={clearTestId}>
                Limpar
              </Button>
            )}
            {onApply && (
              <Button type="button" size="sm" onClick={onApply} className="h-8 text-xs px-5" data-testid={applyTestId}>
                Filtrar
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
    </section>
  );
}

export function FilterField({ label, children, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

/** Campo de busca com lupa - o padrão "digite para filtrar" dos filtros. */
export function SearchInput({ value, onChange, className, ...props }) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
      <Input value={value} onChange={onChange} className={cn('h-9 text-sm pl-8', className)} {...props} />
    </div>
  );
}

/** Card da lista: título + contador à esquerda, barra de ações à direita. */
export function DataCard({ title, count, meta, toolbar, children, footer, className, testId }) {
  return (
    <section className={cn(SURFACE, 'overflow-hidden', className)} data-testid={testId}>
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          {count !== undefined && count !== null && (
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-semibold px-2 py-0.5 tabular-nums">
              {count}
            </span>
          )}
          {meta}
        </div>
        {toolbar}
      </div>
      {children}
      {footer}
    </section>
  );
}

/** Barra de ações da lista. `primary` é o botão principal (ex.: Novo). */
export function Toolbar({ children, primary, selectedCount = 0 }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {selectedCount > 0 && (
        <span className="text-[11px] font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5">
          {selectedCount} selecionado{selectedCount > 1 ? 's' : ''}
        </span>
      )}
      {children && (
        <div className="flex items-center gap-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
          {children}
        </div>
      )}
      {primary}
    </div>
  );
}

export function ToolbarButton({ icon: Icon, label, onClick, disabled, tone = 'slate', testId }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      data-testid={testId}
      className="h-8 w-8 p-0 disabled:opacity-35"
    >
      <Icon className={cn('w-4 h-4', ICON_TONES[tone] || ICON_TONES.slate)} />
    </Button>
  );
}

export function ToolbarDivider() {
  return <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />;
}

export function ToolbarPrimary({ icon: Icon, label, onClick, disabled, testId }) {
  return (
    <Button type="button" size="sm" onClick={onClick} disabled={disabled} data-testid={testId} className="h-9 px-3.5 text-[13px] gap-1.5">
      {Icon && <Icon className="w-4 h-4" />}
      {label}
    </Button>
  );
}

/** Selo de status (Entrada/Saída, Cheio/Vazio, Pago/Pendente...). */
export function StatusPill({ tone = 'slate', children, dot = true, className }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
      SOFT_TONES[tone] || SOFT_TONES.slate,
      className,
    )}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

/** Placa de veículo com cara de placa (fonte mono, borda). */
export function PlateTag({ children }) {
  if (!children) return <span className="text-slate-400">-</span>;
  return (
    <span className="inline-block whitespace-nowrap rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-px font-mono text-[12px] tracking-wide text-slate-700 dark:text-slate-200">
      {children}
    </span>
  );
}

/** Iniciais + nome curto do usuário. */
export function UserTag({ name }) {
  if (!name) return <span className="text-slate-400">-</span>;
  const parts = name.trim().split(/\s+/);
  const short = parts.slice(0, 2).join(' ');
  const initials = (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-semibold flex items-center justify-center">
        {initials}
      </span>
      {short}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, hint, testId }) {
  return (
    <div className="px-6 py-14 text-center" data-testid={testId}>
      {Icon && (
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <Icon className="w-6 h-6 text-slate-400 dark:text-slate-500" />
        </div>
      )}
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {hint && <p className="text-xs mt-1 text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

function PageButton({ page, currentPage, onPageChange }) {
  const active = page === currentPage;
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={() => onPageChange(page)}
      className={cn('h-8 min-w-8 px-2 text-xs tabular-nums', !active && 'bg-white dark:bg-slate-900')}
    >
      {page}
    </Button>
  );
}

/** Rodapé de paginação padrão ("Mostrando 1–15 de 993" + navegação). */
export function TablePagination({ currentPage, totalPages, totalItems, pageSize, onPageChange }) {
  if (totalPages <= 1) return null;
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  let firstPage = Math.max(1, currentPage - 2);
  const lastPage = Math.min(totalPages, firstPage + 4);
  firstPage = Math.max(1, lastPage - 4);
  const pages = [];
  for (let p = firstPage; p <= lastPage; p += 1) pages.push(p);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Mostrando <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{start}–{end}</span> de{' '}
        <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{totalItems.toLocaleString('pt-BR')}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="h-8 px-2 text-xs bg-white dark:bg-slate-900">
          <ChevronLeft className="w-3.5 h-3.5" /> Anterior
        </Button>
        <div className="hidden md:flex items-center gap-1">
          {firstPage > 1 && <PageButton page={1} currentPage={currentPage} onPageChange={onPageChange} />}
          {firstPage > 2 && <span className="px-0.5 text-xs text-slate-400">…</span>}
          {pages.map((p) => (
            <PageButton key={p} page={p} currentPage={currentPage} onPageChange={onPageChange} />
          ))}
          {lastPage < totalPages - 1 && <span className="px-0.5 text-xs text-slate-400">…</span>}
          {lastPage < totalPages && <PageButton page={totalPages} currentPage={currentPage} onPageChange={onPageChange} />}
        </div>
        <Button variant="outline" size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="h-8 px-2 text-xs bg-white dark:bg-slate-900">
          Próxima <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
