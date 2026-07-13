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
      toast.info('Abrindo impressão...');
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
      toast.error('Erro ao carregar movimentação');
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
      {/* HEADER: Logo + Nome da Empresa */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        marginBottom: '10px',
        gap: '12px'
      }}>
        <img 
          src="https://customer-assets.emergentagent.com/job_da181895-6b28-4daf-bef5-4444909581e8/artifacts/i8vfweuv_logo.png" 
          alt="J.A Logística" 
          style={{ height: '50px', width: 'auto' }}
        />
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            fontSize: '24px', 
            fontWeight: 'bold', 
            color: '#000',
            fontFamily: 'Arial Black, sans-serif',
            letterSpacing: '1px'
          }}>
            J.A LOGÍSTICA
          </div>
          <div style={{ 
            fontSize: '12px', 
            color: '#000',
            fontWeight: '500',
            textAlign: 'center'
          }}>
            Logística e Armazenagem
          </div>
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
              <div style={{ 
                display: 'inline-block',
                backgroundColor: '#fff', 
                color: '#000', 
                padding: '2px 8px', 
                border: '1px solid #000',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 'bold'
              }}>
                {movement.operation_type}
              </div>
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
          {/* Linha 2: Placa Cavalo | Placa Carreta 1º | Placa Carreta 2º */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Placa Cavalo</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.truck_plate}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Placa Carreta 1º</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.trailer_plate_1}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Placa Carreta 2º</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.trailer_plate_2 || '-'}</div>
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
          {/* Linha 3: Nota Fiscal | Cliente */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Nota Fiscal</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.invoice_number || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#000', marginBottom: '2px' }}>Cliente</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#000' }}>{movement.client_name || '-'}</div>
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

      {/* BOX 5: Vistoria de Container - Exibir se houver avarias marcadas ou fotos anexadas */}
      {((movement.container_damages && movement.container_damages.length > 0) || movement.container_photos) && (
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
              <div style={{ fontSize: '10px', color: '#000' }}>
                {Object.keys(movement.container_photos).length} foto(s) do container anexada(s) ao registro digital.
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
          J.A LOGÍSTICA - Logística e Armazenagem | Este documento é válido como comprovante de movimentação
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
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
                Detalhes da Movimentação
              </h1>
              <p className="text-muted-foreground mt-1">Visualização</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/movements')} data-testid="back-button">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Voltar
              </Button>
              <Button variant="outline" onClick={() => navigate(`/movements/${id}/edit`)} data-testid="edit-button">
                <Edit className="w-4 h-4 mr-2" />
                Editar
              </Button>
              <Button onClick={() => window.print()} data-testid="print-button">
                <Printer className="w-4 h-4 mr-2" />
                Imprimir
              </Button>
            </div>
          </div>

          {/* ===== CONTEÚDO PARA VISUALIZAÇÃO NA TELA ===== */}
          {/* Informações da Operação */}
          <div className="mb-2 border-2 border-black rounded-lg bg-white overflow-hidden">
            <div className="px-3 py-1 border-b border-black bg-slate-100">
              <p className="text-xs font-bold">Informações da Operação</p>
            </div>
            <div className="px-3 py-2">
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-[10px] text-muted-foreground">ID Transação</p>
                  <p className="font-bold text-sm font-mono text-primary">#{movement.transaction_id}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Tipo de Operação</p>
                  <p className="font-bold">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      movement.operation_type === 'ENTRADA' 
                        ? 'bg-primary/20 text-primary' 
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {movement.operation_type}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Status</p>
                  <p className="font-bold text-xs">{movement.status}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Data/Hora</p>
                  <p className="font-bold font-mono text-xs">{format(new Date(movement.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Informações do Veículo e Motorista */}
          <div className="mb-2 border-2 border-black rounded-lg bg-white overflow-hidden">
            <div className="px-3 py-1 border-b border-black bg-slate-100">
              <p className="text-xs font-bold">Informações do Veículo e Motorista</p>
            </div>
            <div className="px-3 py-2">
              <div className="grid grid-cols-3 gap-2 text-xs mb-1">
                <div>
                  <p className="text-[10px] text-muted-foreground">Motorista</p>
                  <p className="font-bold text-xs">{movement.driver_name}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">CPF</p>
                  <p className="font-bold font-mono text-xs">{movement.driver_cpf}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Transportadora</p>
                  <p className="font-bold text-xs">{movement.transport_company}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-[10px] text-muted-foreground">Placa Cavalo</p>
                  <p className="font-bold font-mono text-xs">{movement.truck_plate}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Placa Carreta 1º</p>
                  <p className="font-bold font-mono text-xs">{movement.trailer_plate_1}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Placa Carreta 2º</p>
                  <p className="font-bold font-mono text-xs">{movement.trailer_plate_2 || '-'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Informações do Contêiner */}
          <div className="mb-2 border-2 border-black rounded-lg bg-white overflow-hidden">
            <div className="px-3 py-1 border-b border-black bg-slate-100">
              <p className="text-xs font-bold">Informações do Contêiner</p>
            </div>
            <div className="px-3 py-2">
              <div className="grid grid-cols-4 gap-2 text-xs mb-1">
                <div>
                  <p className="text-[10px] text-muted-foreground">Nº Container</p>
                  <p className="font-bold font-mono text-xs">{movement.container_number}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Tamanho/Tipo</p>
                  <p className="font-bold font-mono text-xs">{movement.size_type}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Armador</p>
                  <p className="font-bold text-xs">{movement.shipping_line}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Tara</p>
                  <p className="font-bold font-mono text-xs">{movement.tare || '-'}</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs mb-1">
                <div>
                  <p className="text-[10px] text-muted-foreground">Lacre</p>
                  <p className="font-bold font-mono text-xs">{movement.seal || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Genset</p>
                  <p className="font-bold font-mono text-xs">{movement.genset || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Booking</p>
                  <p className="font-bold font-mono text-xs">{movement.booking || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Tipo de Serviço</p>
                  <p className="font-bold text-xs">{movement.service_type || '-'}</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-[10px] text-muted-foreground">Nota Fiscal</p>
                  <p className="font-bold font-mono text-xs">{movement.invoice_number || '-'}</p>
                </div>
                <div className="col-span-3">
                  <p className="text-[10px] text-muted-foreground">Cliente</p>
                  <p className="font-bold text-xs">{movement.client_name || '-'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Observações - Exibir apenas se houver */}
          {movement.observations && (
            <div className="mb-2 border-2 border-black rounded-lg bg-white overflow-hidden">
              <div className="px-3 py-1 border-b border-black bg-slate-100">
                <p className="text-xs font-bold">Observações</p>
              </div>
              <div className="px-3 py-2">
                <p className="text-xs whitespace-pre-wrap">{movement.observations}</p>
              </div>
            </div>
          )}

          {/* Fotos do Container */}
          {movement.container_photos && Object.keys(movement.container_photos).length > 0 && (
            <Card className="mb-2">
              <CardHeader className="bg-slate-50 py-2">
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