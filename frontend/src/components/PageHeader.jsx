import { Button } from './ui/button';
import { RefreshCw, HelpCircle, Plus, Settings, MoreVertical } from 'lucide-react';
import { Reveal } from './Motion';

function ToolbarIcon({ icon: Icon, onClick, title }) {
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 dark:text-slate-400 hover:text-primary" onClick={onClick} title={title}>
      <Icon className="w-4 h-4" />
    </Button>
  );
}

/**
 * Cabeçalho padrão das telas: ícone do módulo num quadro na cor da marca,
 * título, subtítulo (+ `meta` opcional ao lado, ex.: selo "Sincronizado") e
 * ações à direita.
 */
export default function PageHeader({ title, subtitle, icon: Icon, meta, actions, toolbar }) {
  return (
    <Reveal y={6} className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="hidden sm:flex w-10 h-10 shrink-0 rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 items-center justify-center">
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
          {(subtitle || meta) && (
            <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              {subtitle && <span>{subtitle}</span>}
              {meta}
            </div>
          )}
        </div>
      </div>
      {(toolbar || actions) && (
        <div className="flex items-center gap-2">
          {toolbar && (
            <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md p-0.5">
              {toolbar.onRefresh && <ToolbarIcon icon={RefreshCw} onClick={toolbar.onRefresh} title="Atualizar" />}
              {toolbar.onHelp && <ToolbarIcon icon={HelpCircle} onClick={toolbar.onHelp} title="Ajuda" />}
              {toolbar.onNew && <ToolbarIcon icon={Plus} onClick={toolbar.onNew} title="Novo" />}
              {toolbar.onSettings && <ToolbarIcon icon={Settings} onClick={toolbar.onSettings} title="Configurações" />}
              {toolbar.onMore && <ToolbarIcon icon={MoreVertical} onClick={toolbar.onMore} title="Mais opções" />}
            </div>
          )}
          {actions}
        </div>
      )}
    </Reveal>
  );
}
