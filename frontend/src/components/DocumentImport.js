import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ChevronDown, FileText, FileUp, Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { api } from '../lib/api';
import { compressImage } from '../lib/imageCompression';

// Importação de documento (CNH, RG/CIN, CRLV) nos cadastros: o servidor lê a
// foto ou o PDF e devolve os campos, que vão para o formulário destacados
// para conferência - nada é salvo até o usuário salvar o cadastro.

export const DOCUMENT_KIND_LABELS = { cnh: 'CNH', rg: 'RG / Identidade', crlv: 'CRLV' };

// Destaque dos campos preenchidos pelo documento
export const IMPORTED_FIELD_CLASS = 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30';

// Grava no formulário os campos lidos que ele tem; valor vazio do documento
// não apaga o que já estava digitado. `onlyIfEmpty` lista campos que só são
// preenchidos se estiverem vazios (ex.: Tipo do veículo, que é dedução).
export function applyDocumentFields(form, fields, { onlyIfEmpty = [] } = {}) {
  const next = { ...form };
  const applied = [];
  for (const [name, value] of Object.entries(fields || {})) {
    if (!(name in next) || value === null || value === undefined || value === '') continue;
    if (onlyIfEmpty.includes(name) && next[name]) continue;
    next[name] = typeof value === 'number' ? String(value) : value;
    applied.push(name);
  }
  return { next, applied };
}

export function addAttachment(list, url) {
  const current = Array.isArray(list) ? list : [];
  return url && !current.includes(url) ? [...current, url] : current;
}

export function DocumentImportButton({ kinds, onRead, disabled }) {
  const inputRef = useRef(null);
  const kindRef = useRef(kinds[0]);
  const [loading, setLoading] = useState(false);

  const pick = (kind) => {
    kindRef.current = kind;
    inputRef.current?.click();
  };

  const handleFile = async (e) => {
    const original = e.target.files?.[0];
    e.target.value = '';
    if (!original) return;
    const kind = kindRef.current;
    setLoading(true);
    try {
      const file = await compressImage(original, { maxDimension: 2000, quality: 0.85 });
      const { data } = await api.readDocument(kind, file);
      if (!data.found) {
        toast.error(`Não encontrei os dados de ${DOCUMENT_KIND_LABELS[kind]} neste arquivo`);
        return;
      }
      onRead(data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao ler o documento');
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
      {loading ? 'Lendo documento...' : 'Importar documento'}
    </>
  );

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFile} />
      {kinds.length === 1 ? (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled || loading} onClick={() => pick(kinds[0])}>
          {content} ({DOCUMENT_KIND_LABELS[kinds[0]]})
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled || loading}>
              {content}
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {kinds.map((kind) => (
              <DropdownMenuItem key={kind} onClick={() => pick(kind)}>
                <FileText className="w-4 h-4 mr-2" />
                {DOCUMENT_KIND_LABELS[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <p className="text-xs text-muted-foreground">Foto ou PDF. Os campos lidos ficam destacados para você conferir antes de salvar.</p>
    </>
  );
}

// Resumo da leitura: quantos campos vieram, avisos e dados só para conferência
export function DocumentImportNotice({ notice, onClose }) {
  if (!notice) return null;
  const { label, count, warnings = [], info = [] } = notice;
  return (
    <div className="relative rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2.5 pr-9 text-[13px] text-amber-900 dark:text-amber-100 space-y-1">
      <button type="button" aria-label="Fechar aviso" onClick={onClose} className="absolute right-2 top-2 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/60">
        <X className="w-4 h-4" />
      </button>
      <p className="font-medium">
        {count} campo(s) preenchido(s) pela {label}. Confira os campos destacados antes de salvar.
      </p>
      {info.map(([k, v]) => <p key={k}>{k}: <strong>{v}</strong></p>)}
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}

// Arquivos dos documentos importados, guardados no cadastro
export function DocumentAttachments({ value, onChange }) {
  const files = Array.isArray(value) ? value : [];
  if (!files.length) {
    return <p className="text-xs text-muted-foreground">Nenhum documento anexado. Use "Importar documento" para ler e anexar.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {files.map((url, index) => (
        <li key={url} className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-[13px]">
          <FileText className="w-4 h-4 shrink-0 text-slate-500" />
          <a href={api.getFileUrl(url)} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-primary hover:underline">
            Documento {index + 1} ({/\.pdf$/i.test(url) ? 'PDF' : 'imagem'})
          </a>
          <button
            type="button"
            aria-label={`Remover documento ${index + 1}`}
            onClick={() => onChange(files.filter((f) => f !== url))}
            className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
