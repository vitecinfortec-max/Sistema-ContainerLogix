import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Printer, ArrowLeft, Edit, Camera, ZoomIn, Download } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import JsBarcode from 'jsbarcode';
import { DAMAGE_LABELS } from '../components/ContainerPhotoUpload';
import { useCompanySettings, getCompanyLogoUrl } from '../lib/useCompanySettings';
import {
  PRINT_COLORS, PrintHeader, PrintSection, PrintFieldGrid, PrintField, PrintSignatures, PrintClosing,
} from '../components/PrintDocument';

// Função para gerar código de barras como imagem base64
function generateBarcodeImage(value) {
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, value, {
      format: 'CODE128',
      width: 2,
      height: 50,
      displayValue: false,
      margin: 0,
      background: '#ffffff'
    });
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Erro ao gerar código de barras:', error);
    return null;
  }
}

export default function MovementDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const company = useCompanySettings();
  const [movement, setMovement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);
  const [barcodeImage, setBarcodeImage] = useState(null);
  const autoPrintExecuted = useRef(false);

  const PHOTO_LABELS = {
    frente: 'Frente',
    traseira: 'Traseira',
    esquerda: 'Lado Esquerdo',
    direita: 'Lado Direito'
  };

  const getPhotoUrl = (path) => {
    if (!path) return null;
    
    // Se a URL já for completa (http/https), retornar como está
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    
    // Extrair apenas o nome do arquivo
    const filename = path.split('/').pop();
    
    // Construir URL completa com /api/uploads/
    return api.getFileUrl(`/api/uploads/${filename}`);
  };

  useEffect(() => {
    loadMovement();
  }, [id]);

  // Auto-print quando vier da página de criação
  useEffect(() => {
    const autoprint = searchParams.get('autoprint');
    if (autoprint === 'true' && movement && !loading && !autoPrintExecuted.current) {
      autoPrintExecuted.current = true;
      // Sem toast aqui - qualquer notificação ainda visível (inclusive a de
      // sucesso da página anterior) fica capturada no PDF/impressão junto
      // com o conteúdo da página. toast.dismiss() garante que nenhuma fique
      // sobreposta ao comprovante no momento do print.
      toast.dismiss();
      setTimeout(() => window.print(), 500);
    }
  }, [movement, loading, searchParams]);

  const loadMovement = async () => {
    try {
      const response = await api.getMovement(id);
      setMovement(response.data);
      
      // Gerar código de barras
      const barcodeValue = String(response.data.transaction_id).padStart(6, '0');
      const barcodeImg = generateBarcodeImage(barcodeValue);
      setBarcodeImage(barcodeImg);
    } catch (error) {
      toast.error('Erro ao carregar registro');
      navigate('/movements');
    } finally {
      setLoading(false);
    }
  };

  // Via impressa do comprovante (abre sozinha ao emitir a EIR e no botão
  // "Imprimir"). É o mesmo documento do "Baixar PDF" da lista, gerado no
  // servidor por generate_movement_voucher_pdf (backend/reports.py): mesmos
  // quadros, campos, ordem e regras - mudou lá, mudar aqui. Uma página A4 por via.
  const ViaSection = ({ viaLabel }) => {
    const damages = movement.container_damages || [];
    const photos = movement.container_photos;
    const isEntry = movement.operation_type === 'ENTRADA';
    const ROW_GAP = '10pt'; // distância entre as linhas de campos, medida no PDF do servidor
    const CLOSE_TO_TITLE = { marginTop: '-3pt' }; // quadro sem linhas de campos: texto logo abaixo do título
    return (
      <div className="via-section print-doc" style={{
        width: '210mm',
        height: '297mm',
        maxHeight: '297mm',
        padding: '10mm 12mm',
        fontFamily: 'Helvetica, Arial, sans-serif',
        backgroundColor: '#fff',
        boxSizing: 'border-box',
        overflow: 'hidden',
        pageBreakAfter: 'always',
        pageBreakInside: 'avoid'
      }}>
        <PrintHeader
          company={company}
          logoUrl={getCompanyLogoUrl(company)}
          title="Comprovante de Movimentação"
          subtitle={`ID Transação #${movement.transaction_id}  ·  ${viaLabel}`}
        />

        <PrintSection title="Informações da Operação">
          <PrintFieldGrid fields={[
            ['ID Transação', `#${movement.transaction_id}`],
            ['Tipo de Operação', <span style={{ color: isEntry ? PRINT_COLORS.primary : '#B45309' }}>{movement.operation_type}</span>],
            ['Status', movement.status],
            ['Data/Hora', format(new Date(movement.created_at), 'dd/MM/yyyy HH:mm')],
          ]} />
        </PrintSection>

        <PrintSection title="Informações do Veículo e Motorista">
          <PrintFieldGrid columns={3} rowGap={ROW_GAP} fields={[
            ['Motorista', movement.driver_name],
            ['CPF', movement.driver_cpf],
            ['Transportadora', movement.transport_company],
          ]} />
          <div style={{ height: ROW_GAP }} />
          <PrintFieldGrid columns={2} fields={[
            ['Placa Cavalo', movement.truck_plate],
            ['Placa Carreta', movement.trailer_plate_1],
          ]} />
        </PrintSection>

        <PrintSection title="Informações do Contêiner">
          <PrintFieldGrid rowGap={ROW_GAP} fields={[
            ['Número Container', movement.container_number],
            ['Tamanho/Tipo', movement.size_type],
            ['Armador', movement.shipping_line],
            ['Tara', movement.tare],
            ['Lacre', movement.seal],
            ['Genset', movement.genset],
            ['Booking', movement.booking],
            ['Tipo de Serviço', movement.service_type],
          ]} />
          <div style={{ height: ROW_GAP }} />
          <PrintFieldGrid columns={3} fields={[
            ['Nota Fiscal', movement.invoice_number],
            ['Cliente', movement.client_name],
            ['Terminal de Origem', movement.origin_terminal],
          ]} />
        </PrintSection>

        {movement.observations && (
          <PrintSection title="Observações">
            <div style={{ ...CLOSE_TO_TITLE, fontSize: '9pt', lineHeight: '12pt', color: PRINT_COLORS.text, whiteSpace: 'pre-wrap' }}>
              {movement.observations}
            </div>
          </PrintSection>
        )}

        {/* Só aparece se houver avaria marcada, foto anexada ou observação de vistoria */}
        {(damages.length > 0 || photos || movement.inspection_notes) && (
          <PrintSection title="Vistoria de Container">
            <div style={CLOSE_TO_TITLE}>
              <PrintField
                label="Estado do Container"
                value={damages.length > 0 ? damages.map((d) => DAMAGE_LABELS[d] || d).join(', ') : '-'}
              />
            </div>
            {photos && (
              <div style={{ fontSize: '8pt', lineHeight: '10pt', color: PRINT_COLORS.muted, marginTop: '4pt' }}>
                {Object.keys(photos).length} foto(s) do container anexada(s) ao registro digital.
              </div>
            )}
            {movement.inspection_notes && (
              <div style={{ marginTop: '4pt', whiteSpace: 'pre-wrap' }}>
                <PrintField label="Observações da Vistoria" value={movement.inspection_notes} />
              </div>
            )}
          </PrintSection>
        )}

        <PrintSignatures signers={[
          ['Assinatura do Motorista', `${movement.driver_name || '-'}  ·  CPF ${movement.driver_cpf || '-'}`],
          ['Assinatura do Responsável', `${movement.user_name || '-'}  ·  ${format(new Date(), 'dd/MM/yyyy')}`],
        ]} />

        <div style={{ height: '2pt' }} />
        <PrintClosing
          stacked
          barcodeImage={barcodeImage}
          code={movement.transaction_id}
          fields={[
            ['Usuário', movement.user_name],
            ['Data e hora da impressão', format(new Date(), 'dd/MM/yyyy HH:mm')],
          ]}
          companyName={company.name}
          note="Este documento é válido como comprovante de movimentação"
        />
      </div>
    );
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  if (!movement) return null;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto" data-testid="movement-detail-page">
        {/* ===== ÁREA DE IMPRESSÃO (OCULTA NA TELA) ===== */}
        <div className="print-only">
          <ViaSection viaLabel="Via Terminal" />
          <ViaSection viaLabel="Via Motorista" />
        </div>

        {/* ===== CONTEÚDO PARA VISUALIZAÇÃO NA TELA (OCULTO NA IMPRESSÃO) ===== */}
        <div className="no-print">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Detalhes do Gate
              </h1>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Visualização</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/movements')} data-testid="back-button">
                <ArrowLeft className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Voltar</span>
              </Button>
              <Button variant="outline" onClick={() => navigate(`/movements/${id}/edit`)} data-testid="edit-button">
                <Edit className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Editar</span>
              </Button>
              <Button onClick={() => window.print()} data-testid="print-button">
                <Printer className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Imprimir</span>
              </Button>
            </div>
          </div>

          {/* ===== CONTEÚDO PARA VISUALIZAÇÃO NA TELA ===== */}
          {/* Mesmo padrão visual (Card + badges) já usado na lista/Emitir EIR,
              em vez das caixas antigas de borda preta grossa. */}
          {/* Informações da Operação */}
          <Card className="mb-2 border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações da Operação</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">ID Transação</p>
                  <p className="font-semibold text-sm font-mono text-primary">#{movement.transaction_id}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Tipo de Operação</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                    movement.operation_type === 'ENTRADA'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {movement.operation_type}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Status</p>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    movement.status === 'CHEIO'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>
                    {movement.status}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Data/Hora</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{format(new Date(movement.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Informações do Veículo e Motorista */}
          <Card className="mb-2 border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Veículo e Motorista</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs mb-2">
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Motorista</p>
                  <p className="font-semibold text-xs text-slate-800 dark:text-slate-200">{movement.driver_name}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">CPF</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.driver_cpf}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Transportadora</p>
                  <p className="font-semibold text-xs text-slate-800 dark:text-slate-200">{movement.transport_company}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Placa Cavalo</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.truck_plate}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Placa Carreta</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.trailer_plate_1}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Informações do Contêiner */}
          <Card className="mb-2 border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Contêiner</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Nº Container</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.container_number}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Tamanho/Tipo</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.size_type}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Armador</p>
                  <p className="font-semibold text-xs text-slate-800 dark:text-slate-200">{movement.shipping_line}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Tara</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.tare || '-'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Lacre</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.seal || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Genset</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.genset || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Booking</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.booking || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Tipo de Serviço</p>
                  <p className="font-semibold text-xs text-slate-800 dark:text-slate-200">{movement.service_type || '-'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Nota Fiscal</p>
                  <p className="font-semibold font-mono text-xs text-slate-800 dark:text-slate-200">{movement.invoice_number || '-'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Cliente</p>
                  <p className="font-semibold text-xs text-slate-800 dark:text-slate-200">{movement.client_name || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Terminal de Origem</p>
                  <p className="font-semibold text-xs text-slate-800 dark:text-slate-200">{movement.origin_terminal || '-'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Comprador</p>
                  <p className="font-semibold text-xs text-slate-800 dark:text-slate-200">{movement.buyer_name || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Observações - Exibir apenas se houver */}
          {movement.observations && (
            <Card className="mb-2 border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Observações</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <p className="text-xs whitespace-pre-wrap text-slate-800 dark:text-slate-200">{movement.observations}</p>
              </CardContent>
            </Card>
          )}

          {/* Fotos do Container */}
          {movement.container_photos && Object.keys(movement.container_photos).length > 0 && (
            <Card className="mb-2 border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  Fotos do Container ({Object.keys(movement.container_photos).length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(movement.container_photos).map(([position, url]) => (
                    <div key={position} className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium">{PHOTO_LABELS[position] || position}</p>
                      <div 
                        className="relative aspect-square rounded-lg overflow-hidden border cursor-pointer group"
                        onClick={() => setPreviewImage({ url: getPhotoUrl(url), label: PHOTO_LABELS[position] || position })}
                        data-testid={`photo-view-${position}`}
                      >
                        <img 
                          src={getPhotoUrl(url)} 
                          alt={PHOTO_LABELS[position]}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // Tentar recarregar com URL corrigida se falhar
                            const currentSrc = e.target.src;
                            const filename = currentSrc.split('/').pop();
                            const baseUrl = process.env.REACT_APP_BACKEND_URL || '';
                            const newSrc = `${baseUrl}/api/uploads/${filename}`;
                            if (currentSrc !== newSrc) {
                              e.target.src = newSrc;
                            }
                          }}
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <ZoomIn className="w-8 h-8 text-white" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Modal de visualização de foto */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{previewImage?.label}</span>
              {previewImage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = previewImage.url;
                    link.download = `container_${previewImage.label.toLowerCase().replace(/\s+/g, '_')}.jpg`;
                    link.target = '_blank';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  data-testid="download-photo-btn"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Baixar Foto
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center">
            {previewImage && (
              <img 
                src={previewImage.url} 
                alt={previewImage.label}
                className="max-h-[70vh] object-contain rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}