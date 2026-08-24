import { Button } from './ui/button';
import { RefreshCw, HelpCircle, Plus, Settings, MoreVertical } from 'lucide-react';

function ToolbarIcon({ icon: Icon, onClick, title }) {
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 dark:text-slate-400 hover:text-primary" onClick={onClick} title={title}>
      <Icon className="w-4 h-4" />
    </Button>
  );
}

export default function PageHeader({ title, subtitle, icon: Icon, actions, toolbar }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4" />}
          {title}
        </h1>
        {subtitle && <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
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
    </div>
  );
}
