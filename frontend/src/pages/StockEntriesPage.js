import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarPrimary, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Upload, Search, FileUp, ArrowLeft, Loader2, PackagePlus, Sparkles } from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (v) => {
  if (!v) return '-';
  try { return format(new Date(v), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); } catch (e) { return '-'; }
};

export default function StockEntriesPage() {
  const [entries, setEntries] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('upload'); // 'upload' | 'review'
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null); // { nfe_number, nfe_key, nfe_issue_date, supplier_name, supplier_cnpj, matched_supplier_id, items: [...] }
  const [confirming, setConfirming] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => { loadEntries(); loadProducts(); }, []);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const r = await api.getStockEntries();
      setEntries(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar entradas de estoque');
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const r = await api.getProducts();
      setProducts(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const resetImport = () => {
    setStep('upload');
    setSelectedFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openImportDialog = () => {
    resetImport();
    setOpen(true);
  };

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files?.[0] || null);
  };

  const handleParse = async () => {
    if (!selectedFile) {
      toast.error('Selecione um arquivo XML');
      return;
    }
    setParsing(true);
    try {
      const r = await api.parseNfeImport(selectedFile);
      const data = r.data;
      setPreview({
        ...data,
        items: data.items.map((it) => ({
          ...it,
          matched_product_id: it.matched_product_id || null,
          matched_product_name: it.matched_product_name || null,
        })),
      });
      setStep('review');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao ler o arquivo XML');
    } finally {
      setParsing(false);
    }
  };

  const setItemField = (index, field, value) => {
    setPreview((p) => {
      const items = [...p.items];
      items[index] = { ...items[index], [field]: value };
      return { ...p, items };
    });
  };

  const setItemProduct = (index, product) => {
    setPreview((p) => {
      const items = [...p.items];
      items[index] = {
        ...items[index],
        matched_product_id: product ? product.id : null,
        matched_product_name: product ? product.description : '',
      };
      return { ...p, items };
    });
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const payload = {
        nfe_number: preview.nfe_number,
        nfe_key: preview.nfe_key,
        nfe_issue_date: preview.nfe_issue_date,
        supplier_cnpj: preview.supplier_cnpj,
        supplier_name: preview.supplier_name,
        matched_supplier_id: preview.matched_supplier_id,
        items: preview.items.map((it) => ({
          barcode: it.barcode || null,
          description: it.description,
          ncm: it.ncm || null,
          cfop: it.cfop || null,
          unit: it.unit || null,
          quantity: Number(it.quantity || 0),
          unit_value: Number(it.unit_value || 0),
          total_value: Number(it.quantity || 0) * Number(it.unit_value || 0),
          matched_product_id: it.matched_product_id || null,
        })),
      };
      const r = await api.confirmNfeImport(payload);
      const { products_created, products_updated, entries_created } = r.data;
      toast.success(`Importação concluída: ${entries_created} entrada(s), ${products_created} produto(s) novo(s), ${products_updated} atualizado(s)`);
      setOpen(false);
      resetImport();
      loadEntries();
      loadProducts();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao confirmar importação');
    } finally {
      setConfirming(false);
    }
  };

  const filteredEntries = entries.filter((e) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (e.product_name || '').toLowerCase().includes(term)
      || (e.supplier_name || '').toLowerCase().includes(term)
      || (e.nfe_number || '').toLowerCase().includes(term);
  });

  return (
    <Layout>
      <div className="space-y-4" data-testid="stock-entries-page">
        <PageHeader icon={PackagePlus} title="Entradas de Estoque" subtitle="Histórico de entradas geradas por importação de XML de Nota Fiscal" />

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Produto, fornecedor ou Nº da NF-e">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search-stock-entries-input" />
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Entradas registradas"
          count={loading ? '...' : filteredEntries.length}
          toolbar={(
            <Toolbar primary={<ToolbarPrimary icon={FileUp} label="Importar XML de NF-e" onClick={openImportDialog} testId="import-nfe-button" />} />
          )}
        >
          {filteredEntries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Produto</th>
                    <th>Fornecedor</th>
                    <th>NF-e Nº</th>
                    <th className="!text-right">Quantidade</th>
                    <th className="!text-right">Valor unit.</th>
                    <th className="!text-right">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((e) => (
                    <tr key={e.id} data-testid="stock-entry-row">
                      <td className="whitespace-nowrap tabular-nums">{fmtDate(e.created_at)}</td>
                      <td><div className="max-w-[320px] truncate cell-strong" title={e.product_name || ''}>{e.product_name}</div></td>
                      <td><div className="max-w-[220px] truncate" title={e.supplier_name || ''}>{e.supplier_name || '-'}</div></td>
                      <td className="whitespace-nowrap tabular-nums">{e.nfe_number || '-'}</td>
                      <td className="text-right tabular-nums">{e.quantity}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{fmtMoney(e.unit_value)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(e.total_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={PackagePlus}
              title={loading ? 'Carregando...' : (search ? 'Nenhuma entrada encontrada' : 'Nenhuma entrada de estoque registrada')}
              hint={loading ? undefined : 'Use "Importar XML de NF-e" para lançar entradas automaticamente'}
            />
          )}
        </DataCard>
      </div>

      <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetImport(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="nfe-import-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="text-base flex items-center gap-2">
              <FileUp className="w-4 h-4 text-primary" />
              Importar XML de Nota Fiscal
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              {step === 'upload'
                ? 'Selecione o arquivo XML da NF-e para gerar produtos e entradas de estoque'
                : 'Confira os itens antes de confirmar - você pode vincular a um produto já cadastrado ou deixar em branco para criar um novo'}
            </DialogDescription>
          </DialogHeader>

          {step === 'upload' && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg p-8 text-center">
                <Upload className="w-10 h-10 mx-auto mb-3 text-slate-400" />
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".xml"
                  onChange={handleFileChange}
                  className="max-w-xs mx-auto text-[13px]"
                  data-testid="nfe-file-input"
                />
                {selectedFile && (
                  <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-2">{selectedFile.name}</p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="button" onClick={handleParse} disabled={parsing || !selectedFile} data-testid="analyze-nfe-button">
                  {parsing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisando...</> : 'Analisar Arquivo'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'review' && preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-3 rounded-md bg-slate-50 dark:bg-slate-800 text-[13px]">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">NF-e Nº: </span>
                  <span className="font-semibold">{preview.nfe_number || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Data de Emissão: </span>
                  <span className="font-semibold">{preview.nfe_issue_date || '-'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 dark:text-slate-400">Fornecedor: </span>
                  <span className="font-semibold">{preview.supplier_name || '-'}</span>
                  {preview.matched_supplier_id ? (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-700">Já cadastrado</span>
                  ) : (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-700">
                      <Sparkles className="w-3 h-3 mr-1" />Novo fornecedor será criado
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {preview.items.map((item, idx) => (
                  <div key={idx} className="border border-slate-200 dark:border-slate-700 rounded-md p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-semibold">{item.description}</p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">NCM: {item.ncm || '-'} · CFOP: {item.cfop || '-'} · Unid.: {item.unit || '-'}</p>
                      </div>
                      {item.matched_product_id ? (
                        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-700">Produto existente</span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-700">Novo produto</span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Vincular a Produto Existente</Label>
                        <Autocomplete
                          value={item.matched_product_name || ''}
                          onChange={(v) => setItemField(idx, 'matched_product_name', v)}
                          onSelect={(p) => setItemProduct(idx, p)}
                          options={products}
                          displayField="description"
                          className="h-9 text-[13px]"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Quantidade</Label>
                        <Input
                          type="number" step="0.01"
                          value={item.quantity}
                          onChange={(e) => setItemField(idx, 'quantity', e.target.value)}
                          className="h-9 text-[13px]"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">Valor Unit.</Label>
                        <Input
                          type="number" step="0.01"
                          value={item.unit_value}
                          onChange={(e) => setItemField(idx, 'unit_value', e.target.value)}
                          className="h-9 text-[13px]"
                        />
                      </div>
                    </div>
                    <p className="text-right text-[12px] text-slate-500 dark:text-slate-400">
                      Valor Total: <span className="font-semibold text-slate-700 dark:text-slate-300">{fmtMoney(Number(item.quantity || 0) * Number(item.unit_value || 0))}</span>
                    </p>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStep('upload')}>
                  <ArrowLeft className="w-4 h-4 mr-1.5" />Voltar
                </Button>
                <Button type="button" onClick={handleConfirm} disabled={confirming} data-testid="confirm-nfe-import-button">
                  {confirming ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando...</> : 'Confirmar Importação'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
