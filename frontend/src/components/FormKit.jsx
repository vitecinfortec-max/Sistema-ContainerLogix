import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { cn } from '../lib/utils';

// Blocos compartilhados das telas de formulário (seção, título de seção,
// campo e rodapé de ações), no mesmo espírito de components/DataPage.jsx pras
// listagens: um ajuste de estilo feito aqui vale pra todos os formulários.

/** Seção do formulário: card com faixa de título e os campos dentro. */
export function FormSection({ title, icon: Icon, actions, children, className, contentClassName, testId }) {
  return (
    <Card className={cn('border border-slate-200 dark:border-slate-700 shadow-none', className)} data-testid={testId}>
      <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800 flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-primary" />}
          {title}
        </CardTitle>
        {actions}
      </CardHeader>
      <CardContent className={cn('p-4 space-y-4', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/**
 * Título de um grupo de campos dentro de um diálogo ou de uma seção.
 * `bare`: sem o filete embaixo (título ao lado de um botão, ex.: "Itens" +
 * "Adicionar").
 */
export function FormSectionTitle({ children, bare = false, className }) {
  return (
    <h3 className={cn(
      'text-[12px] font-bold uppercase tracking-wider text-primary',
      !bare && 'border-b-2 border-primary/20 pb-1',
      className,
    )}>
      {children}
    </h3>
  );
}

/** Campo: rótulo em cima (com "*" se obrigatório), controle e dica opcional. */
export function Field({ label, htmlFor, required, hint, children, className }) {
  return (
    <div className={cn('space-y-1.5 min-w-0', className)}>
      <Label htmlFor={htmlFor} className="block">{required ? `${label} *` : label}</Label>
      {children}
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * Rodapé do formulário: Cancelar e ações secundárias à esquerda do Salvar.
 * `sticky`: no celular a barra fica presa acima da navegação inferior, pra
 * salvar um formulário longo sem rolar até o fim.
 */
export function FormActions({ children, className, sticky = false }) {
  return (
    <div className={cn(
      'flex flex-wrap items-center justify-end gap-2',
      sticky && 'max-md:sticky max-md:bottom-[76px] max-md:z-40 max-md:rounded-lg max-md:border max-md:border-slate-200 max-md:dark:border-slate-700 max-md:bg-card max-md:p-2 max-md:shadow-lg max-md:[&>*]:flex-1',
      className,
    )}>
      {children}
    </div>
  );
}
