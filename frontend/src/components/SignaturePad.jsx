import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { PenLine, Upload, Eraser, Trash2, Save } from 'lucide-react';

// Assinatura de Motorista/Funcionário: desenhada com o dedo/mouse na tela ou
// importada de uma imagem (foto/scan). Sempre sai como data URL PNG - o
// backend (shared.save_signature_value) grava o arquivo e devolve o caminho.

const MAX_IMPORT_W = 1200;
const MAX_IMPORT_H = 600;

/** Recorta as bordas transparentes do desenho, pra assinatura não sair
 *  minúscula no meio de um retângulo vazio nos PDFs. */
function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const pad = 8;
  left = Math.max(0, left - pad); top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad); bottom = Math.min(height - 1, bottom + pad);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d').drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function DrawArea({ onChange, clearSignal }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const points = useRef([]);

  const setup = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    // offsetWidth/Height = tamanho de layout, sem a escala da animação de
    // abertura do diálogo (getBoundingClientRect pegaria o tamanho reduzido)
    canvas.width = Math.max(1, Math.round(canvas.offsetWidth * ratio));
    canvas.height = Math.max(1, Math.round(canvas.offsetHeight * ratio));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = '#0F172A';
    onChange(null);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(setup, 50); return () => clearTimeout(t); }, [clearSignal]);

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? canvas.offsetWidth / rect.width : 1;
    const sy = rect.height ? canvas.offsetHeight / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const start = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    points.current = [p];
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#0F172A';
    ctx.fill();
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pos(e);
    const pts = points.current;
    pts.push(p);
    const ctx = canvasRef.current.getContext('2d');
    if (pts.length === 2) {
      // Primeiro trecho: do ponto onde encostou até o meio do segmento
      const [a, b] = pts;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.stroke();
    } else if (pts.length >= 3) {
      // Curva pelo ponto médio: traço liso em vez de serrilhado
      const a = pts[pts.length - 3], b = pts[pts.length - 2], c = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
      ctx.stroke();
    }
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = points.current;
    if (pts.length >= 2) {
      // Último trecho: do meio do último segmento até onde soltou
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const ctx = canvasRef.current.getContext('2d');
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    onChange(trimCanvas(canvasRef.current));
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      className="w-full h-44 rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-white touch-none cursor-crosshair"
      data-testid="signature-canvas"
    />
  );
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('Arquivo não é uma imagem válida'));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMPORT_W / img.width, MAX_IMPORT_H / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Diálogo pra capturar uma assinatura: desenhar ou importar imagem. */
export function SignatureCaptureDialog({ open, onOpenChange, onSave, personName, saving = false }) {
  const [mode, setMode] = useState('draw');
  const [drawn, setDrawn] = useState(null);
  const [imported, setImported] = useState(null);
  const [clearSignal, setClearSignal] = useState(0);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) { setMode('draw'); setDrawn(null); setImported(null); setClearSignal((n) => n + 1); }
  }, [open]);

  const current = mode === 'draw' ? drawn : imported;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast.error('Selecione um arquivo de imagem (JPG ou PNG)'); return; }
    try { setImported(await readImageFile(file)); } catch (err) { toast.error(err.message); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-lg" data-testid="signature-dialog">
        <DialogHeader>
          <DialogTitle className="text-base">Assinatura{personName ? ` - ${personName}` : ''}</DialogTitle>
          <DialogDescription className="text-[13px]">
            Peça para a pessoa assinar na área abaixo (dedo ou mouse), ou importe a foto da assinatura
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-1 w-fit">
          {[['draw', 'Desenhar', PenLine], ['import', 'Importar imagem', Upload]].map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              data-testid={`signature-mode-${key}`}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                mode === key ? 'bg-primary text-primary-foreground' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {mode === 'draw' ? (
          <div className="space-y-2">
            <DrawArea onChange={setDrawn} clearSignal={clearSignal} />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Assine dentro do quadro</span>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setClearSignal((n) => n + 1)} data-testid="signature-clear">
                <Eraser className="w-3.5 h-3.5" />Limpar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="signature-file-input" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full h-44 rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-white flex items-center justify-center overflow-hidden"
            >
              {imported ? (
                <img src={imported} alt="Assinatura importada" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-[13px] text-slate-500">
                  <Upload className="w-5 h-5" />Clique para escolher a imagem
                </span>
              )}
            </button>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Foto ou scan da assinatura em fundo claro (JPG ou PNG)</span>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => current && onSave(current)} disabled={!current || saving} data-testid="signature-save">
            <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Usar esta assinatura'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** URL exibível de uma assinatura: data URL (ainda não salva) ou caminho no servidor. */
export function signatureSrc(value) {
  if (!value) return null;
  return value.startsWith('data:') ? value : api.getFileUrl(value);
}

/** Campo "Assinatura" do formulário de cadastro (Motorista/Funcionário). */
export function SignatureField({ value, onChange, personName }) {
  const [open, setOpen] = useState(false);
  const src = signatureSrc(value);
  return (
    <div className="space-y-2" data-testid="signature-field">
      <div className="h-24 rounded-md border border-slate-200 dark:border-slate-700 bg-white flex items-center justify-center overflow-hidden">
        {src ? (
          <img src={src} alt="Assinatura" className="max-h-full max-w-full object-contain p-2" />
        ) : (
          <span className="text-[12px] text-slate-400">Nenhuma assinatura cadastrada</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOpen(true)} data-testid="signature-edit-btn">
          <PenLine className="w-3.5 h-3.5" />{src ? 'Trocar assinatura' : 'Adicionar assinatura'}
        </Button>
        {src && (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs gap-1.5 text-red-600 hover:text-red-700" onClick={() => onChange('')} data-testid="signature-remove-btn">
            <Trash2 className="w-3.5 h-3.5" />Remover
          </Button>
        )}
      </div>
      <SignatureCaptureDialog
        open={open}
        onOpenChange={setOpen}
        personName={personName}
        onSave={(dataUrl) => { onChange(dataUrl); setOpen(false); }}
      />
    </div>
  );
}
