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

  // Componente de Via para impressão - Layout compacto para caber em A4
  const ViaSection = ({ viaType }) => (
    <div className="via-section" style={{ 
      width: '210mm',
      height: '297mm',
      maxHeight: '297mm',
      padding: '8mm 12mm',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#fff',
      boxSizing: 'border-box',
      overflow: 'hidden',
      pageBreakAfter: 'always',
      pageBreakInside: 'avoid'
    }}>
      {/* HEADER: Logo + dados completos da empresa - mesmo padrão do PDF gerado
          pelo backend (_build_pdf_header em reports.py), pra ficar igual
          independente de vir do "Baixar PDF" ou da impressão direto da tela. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '10px',
        gap: '14px'
      }}>
        <img
          src={getCompanyLogoUrl(company)}
          alt={company.name}
          style={{ maxHeight: '46px', maxWidth: '46px', width: 'auto', height: 'auto', objectFit: 'contain' }}
        />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#000' }}>
            {company.name}
          </div>
          <div style={{ fontSize: '9px', color: '#000' }}>CNPJ: {company.cnpj}</div>
          {(company.address || '').split('\n').filter(Boolean).map((line, i) => (
            <div key={i} style={{ fontSize: '9px', color: '#000' }}>{line.trim()}</div>
          ))}
          <div style={{ fontSize: '9px', color: '#000' }}>{company.email} | {company.phone}</div>
        </div>
      </div>

      {/* TÍTULO: Fundo branco com borda */}
      <div style={{ 
        backgroundColor: '#fff', 
        border: '2px solid #000',
        padding: '8px 15px', 
        borderRadius: '4px', 
        textAlign: 'center', 
        marginBottom: '10px'
      }}>
        <div style={{ 
          fontSize: '14px', 
          fontWeight: 'bold', 
          color: '#000',
          letterSpacing: '1px'
        }}>
          COMPROVANTE DE MOVIMENTAÇÃO DE CONTÊINER
        </div>
        <div style={{ 
          fontSize: '12px', 
          color: '#000',
          marginTop: '3px'
        }}>
          ID Transação: #{movement.transaction_id} {viaType && `- ${viaType}`}
        </div>
      </div>

      {/* BOX 1: Informações da Operação - 4 colunas */}
      <div style={{ 
        border: '1px solid #000', 
        borderRadius: '4px', 
        marginBottom: '8px',
        overflow: 'hidden'
      }}>
        <div style={{ 
          backgroundColor: '#fff', 
          padding: '5px 10px', 
          borderBottom: '1px solid #000'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>
            Informações da Operação
          </span>
        </div>
        <div style={{ padding: '8px 10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>ID Transação</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>#{movement.transaction_id}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Tipo de Operação</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.operation_type}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Status</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.status}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Data/Hora</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>
                {format(new Date(movement.created_at), 'dd/MM/yyyy HH:mm')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BOX 2: Informações do Veículo e Motorista - 3 colunas, 2 linhas */}
      <div style={{ 
        border: '1px solid #000', 
        borderRadius: '4px', 
        marginBottom: '8px',
        overflow: 'hidden'
      }}>
        <div style={{ 
          backgroundColor: '#fff', 
          padding: '5px 10px', 
          borderBottom: '1px solid #000'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>
            Informações do Veículo e Motorista
          </span>
        </div>
        <div style={{ padding: '8px 10px' }}>
          {/* Linha 1: Motorista | CPF | Transportadora */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr 1fr', 
            gap: '10px',
            marginBottom: '8px',
            paddingBottom: '8px',
            borderBottom: '1px solid #ddd'
          }}>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Motorista</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.driver_name}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>CPF</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.driver_cpf}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Transportadora</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.transport_company}</div>
            </div>
          </div>
          {/* Linha 2: Placa Cavalo | Placa Carreta */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Placa Cavalo</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.truck_plate}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Placa Carreta</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.trailer_plate_1}</div>
            </div>
          </div>
        </div>
      </div>

      {/* BOX 3: Informações do Contêiner - 4 colunas, 3 linhas */}
      <div style={{ 
        border: '1px solid #000', 
        borderRadius: '4px', 
        marginBottom: '8px',
        overflow: 'hidden'
      }}>
        <div style={{ 
          backgroundColor: '#fff', 
          padding: '5px 10px', 
          borderBottom: '1px solid #000'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>
            Informações do Contêiner
          </span>
        </div>
        <div style={{ padding: '8px 10px' }}>
          {/* Linha 1: Nº Container | Tamanho/Tipo | Armador | Tara */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr 1fr 1fr', 
            gap: '10px',
            marginBottom: '8px',
            paddingBottom: '8px',
            borderBottom: '1px solid #ddd'
          }}>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Nº Container</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.container_number}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Tamanho/Tipo</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.size_type}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Armador</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.shipping_line}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Tara</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.tare || '-'}</div>
            </div>
          </div>
          {/* Linha 2: Lacre | Genset | Booking | Tipo de Serviço */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr 1fr 1fr', 
            gap: '10px',
            marginBottom: '8px',
            paddingBottom: '8px',
            borderBottom: '1px solid #ddd'
          }}>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Lacre</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.seal || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Genset</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.genset || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Booking</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.booking || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Tipo de Serviço</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.service_type || '-'}</div>
            </div>
          </div>
          {/* Linha 3: Nota Fiscal | Cliente | Terminal de Origem */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Nota Fiscal</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.invoice_number || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Cliente</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.client_name || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Terminal de Origem</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.origin_terminal || '-'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* BOX 4: Observações - Exibir apenas se houver */}
      {movement.observations && (
        <div style={{ 
          border: '1px solid #000', 
          borderRadius: '4px', 
          marginBottom: '8px',
          overflow: 'hidden'
        }}>
          <div style={{ 
            backgroundColor: '#fff', 
            padding: '5px 10px', 
            borderBottom: '1px solid #000'
          }}>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>
              Observações
            </span>
          </div>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontSize: '11px', color: '#000', whiteSpace: 'pre-wrap' }}>
              {movement.observations}
            </div>
          </div>
        </div>
      )}

      {/* BOX 5: Vistoria de Container - Exibir se houver avarias marcadas, fotos anexadas ou observações de vistoria */}
      {((movement.container_damages && movement.container_damages.length > 0) || movement.container_photos || movement.inspection_notes) && (
        <div style={{
          border: '1px solid #000',
          borderRadius: '4px',
          marginBottom: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            backgroundColor: '#fff',
            padding: '5px 10px',
            borderBottom: '1px solid #000'
          }}>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>
              Vistoria de Container
            </span>
          </div>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Estado do Container</div>
            <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000', marginBottom: '6px' }}>
              {movement.container_damages && movement.container_damages.length > 0
                ? movement.container_damages.map(d => DAMAGE_LABELS[d] || d).join(', ')
                : '-'}
            </div>
            {movement.container_photos && (
              <div style={{ fontSize: '10px', color: '#000', marginBottom: '4px' }}>
                {Object.keys(movement.container_photos).length} foto(s) do container anexada(s) ao registro digital.
              </div>
            )}
            {movement.inspection_notes && (
              <div>
                <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Observações da Vistoria</div>
                <div style={{ fontSize: '10px', color: '#000', whiteSpace: 'pre-wrap' }}>{movement.inspection_notes}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ÁREA DE ASSINATURAS */}
      <div style={{ 
        border: '1px solid #000', 
        borderRadius: '4px', 
        padding: '12px 15px',
        marginBottom: '10px'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          {/* Assinatura do Motorista */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ 
              fontSize: '11px', 
              fontWeight: 'bold', 
              color: '#000',
              marginBottom: '30px'
            }}>
              Assinatura do Motorista
            </div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '6px' }}>
              <div style={{ fontSize: '10px', color: '#000' }}>Nome: {movement.driver_name}</div>
              <div style={{ fontSize: '10px', color: '#000' }}>CPF: {movement.driver_cpf}</div>
            </div>
          </div>
          {/* Assinatura do Responsável */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ 
              fontSize: '11px', 
              fontWeight: 'bold', 
              color: '#000',
              marginBottom: '30px'
            }}>
              Assinatura do Responsável
            </div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '6px' }}>
              <div style={{ fontSize: '10px', color: '#000' }}>Nome: {movement.user_name}</div>
              <div style={{ fontSize: '10px', color: '#000' }}>Data: {format(new Date(), 'dd/MM/yyyy')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* CÓDIGO DE BARRAS E INFORMAÇÕES */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'flex-start',
        gap: '15px',
        marginBottom: '10px',
        paddingBottom: '10px',
        borderBottom: '1px solid #000'
      }}>
        <div>
          {barcodeImage && (
            <img src={barcodeImage} alt="Barcode" style={{ height: '40px', width: 'auto' }} />
          )}
          <div style={{ fontSize: '10px', fontWeight: 'bold', textAlign: 'center', marginTop: '2px', color: '#000' }}>
            {movement.transaction_id}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000', marginBottom: '2px' }}>
            Usuário: {movement.user_name}
          </div>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>
            Data e hora da impressão: {format(new Date(), 'dd/MM/yyyy HH:mm')}
          </div>
        </div>
      </div>

      {/* RODAPÉ */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '9px', color: '#000' }}>
          {company.name} | Este documento é válido como comprovante de movimentação
        </div>
      </div>
    </div>
  );

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
          <ViaSection viaType="VIA TERMINAL" />
          <ViaSection viaType="VIA MOTORISTA" />
        </div>

        {/* ===== CONTEÚDO PARA VISUALIZAÇÃO NA TELA (OCULTO NA IMPRESSÃO) ===== */}
        <div className="no-print">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div>
              <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
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
            <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300">Informações da Operação</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
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
            <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300">Informações do Veículo e Motorista</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
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
            <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300">Informações do Contêiner</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
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
              </div>
            </CardContent>
          </Card>

          {/* Observações - Exibir apenas se houver */}
          {movement.observations && (
            <Card className="mb-2 border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300">Observações</CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <p className="text-xs whitespace-pre-wrap text-slate-800 dark:text-slate-200">{movement.observations}</p>
              </CardContent>
            </Card>
          )}

          {/* Fotos do Container */}
          {movement.container_photos && Object.keys(movement.container_photos).length > 0 && (
            <Card className="mb-2">
              <CardHeader className="bg-slate-50 dark:bg-slate-800 py-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  Fotos do Container ({Object.keys(movement.container_photos).length})
                </CardTitle>
              </CardHeader>
              <CardContent className="py-3">
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