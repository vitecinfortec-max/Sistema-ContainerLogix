import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Printer, Download, Camera, Upload, X, Edit, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import JsBarcode from 'jsbarcode';

// Função para gerar código de barras como imagem base64
function generateBarcodeImage(value) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, {
    format: 'CODE128',
    width: 2,
    height: 50,
    displayValue: true,
    fontSize: 14,
    margin: 5
  });
  return canvas.toDataURL('image/png');
}

export default function ContainerInspectionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [inspection, setInspection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState({});
  const [barcodeImage, setBarcodeImage] = useState(null);
  const printTriggered = useRef(false);
  
  const fileInputRefs = {
    front: useRef(null),
    back: useRef(null),
    left: useRef(null),
    right: useRef(null),
    internal: useRef(null)
  };

  useEffect(() => {
    loadInspection();
  }, [id]);

  useEffect(() => {
    if (inspection) {
      const barcodeValue = `VC${String(inspection.inspection_number).padStart(6, '0')}`;
      const barcodeImg = generateBarcodeImage(barcodeValue);
      setBarcodeImage(barcodeImg);
    }
  }, [inspection]);

  useEffect(() => {
    if (searchParams.get('print') === 'true' && inspection && !printTriggered.current) {
      printTriggered.current = true;
      setTimeout(() => window.print(), 500);
    }
  }, [inspection, searchParams]);

  const loadInspection = async () => {
    try {
      const response = await api.getContainerInspection(id);
      setInspection(response.data);
    } catch (error) {
      toast.error('Erro ao carregar vistoria');
      navigate('/container-inspections');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (position, file) => {
    if (!file) return;
    
    setUploading(prev => ({ ...prev, [position]: true }));
    
    try {
      await api.uploadContainerInspectionPhoto(id, position, file);
      toast.success('Foto enviada com sucesso!');
      loadInspection();
    } catch (error) {
      toast.error('Erro ao enviar foto');
    } finally {
      setUploading(prev => ({ ...prev, [position]: false }));
    }
  };

  const handlePhotoDelete = async (position) => {
    try {
      await api.deleteContainerInspectionPhoto(id, position);
      toast.success('Foto removida com sucesso!');
      loadInspection();
    } catch (error) {
      toast.error('Erro ao remover foto');
    }
  };

  const handleDownloadPhoto = async (photoUrl, label) => {
    try {
      const fullUrl = api.getFileUrl(photoUrl);
      const response = await fetch(fullUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inspection.container_number}_${label.replace(/\s+/g, '_')}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Download iniciado!');
    } catch (error) {
      toast.error('Erro ao baixar foto');
    }
  };

  const getPhotoUrl = (path) => {
    if (!path) return null;
    return api.getFileUrl(path);
  };

  const photoLabels = {
    front: 'Frente',
    back: 'Traseira',
    left: 'Lateral Esquerda',
    right: 'Lateral Direita',
    internal: 'Interno'
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!inspection) {
    return (
      <Layout>
        <div className="text-center py-8">Vistoria não encontrada</div>
      </Layout>
    );
  }

  // Componente de impressão
  const PrintView = () => (
    <div className="print-only">
      <div className="print-registry" style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '8mm',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#fff',
        boxSizing: 'border-box'
      }}>
        {/* Header */}
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
            style={{ height: '40px', width: 'auto' }}
          />
          <div style={{ textAlign: 'center' }}>
            <div style={{ 
              fontSize: '20px', 
              fontWeight: 'bold', 
              color: '#000',
              fontFamily: 'Arial Black, sans-serif'
            }}>
              J.A LOGÍSTICA
            </div>
            <div style={{ fontSize: '10px', color: '#000' }}>
              Logística e Armazenagem
            </div>
          </div>
        </div>

        {/* Título */}
        <div style={{ 
          backgroundColor: '#fff', 
          border: '2px solid #000',
          padding: '6px 10px', 
          borderRadius: '4px', 
          textAlign: 'center', 
          marginBottom: '10px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#000' }}>
            VISTORIA DE CONTÊINER
          </div>
          <div style={{ fontSize: '11px', color: '#000', marginTop: '2px' }}>
            Vistoria Nº {inspection.inspection_number}
          </div>
        </div>

        {/* Informações */}
        <div style={{ 
          border: '1px solid #000', 
          borderRadius: '4px', 
          marginBottom: '8px',
          overflow: 'hidden'
        }}>
          <div style={{ 
            backgroundColor: '#f0f0f0', 
            padding: '4px 8px', 
            borderBottom: '1px solid #000',
            fontWeight: 'bold',
            fontSize: '10px'
          }}>
            Informações do Container
          </div>
          <div style={{ padding: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Número do Container</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.container_number}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Numeração do Container</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.container_seal || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Terminal de Coleta</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.collection_terminal || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Booking</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.booking || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Cliente</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.client_name || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Armador</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.shipping_line_name || '-'}</div>
            </div>
          </div>
        </div>

        {/* Observações */}
        {inspection.observations && (
          <div style={{ 
            border: '1px solid #000', 
            borderRadius: '4px', 
            marginBottom: '8px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              backgroundColor: '#f0f0f0', 
              padding: '4px 8px', 
              borderBottom: '1px solid #000',
              fontWeight: 'bold',
              fontSize: '10px'
            }}>
              Observações
            </div>
            <div style={{ padding: '8px', fontSize: '10px' }}>
              {inspection.observations}
            </div>
          </div>
        )}

        {/* Fotos - Frente, Traseira, Interno (primeira linha) */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr 1fr', 
          gap: '6px',
          marginBottom: '6px'
        }}>
          {['front', 'back', 'internal'].map(position => (
            <div key={position} style={{ 
              border: '1px solid #000', 
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{ 
                backgroundColor: '#f0f0f0', 
                padding: '3px 8px', 
                borderBottom: '1px solid #000',
                fontWeight: 'bold',
                fontSize: '9px',
                textAlign: 'center'
              }}>
                {photoLabels[position]}
              </div>
              <div style={{ 
                height: '55mm', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                backgroundColor: '#fafafa',
                padding: '4px'
              }}>
                {inspection[`photo_${position}`] ? (
                  <img 
                    src={getPhotoUrl(inspection[`photo_${position}`])} 
                    alt={photoLabels[position]}
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'contain'
                    }}
                  />
                ) : (
                  <span style={{ fontSize: '9px', color: '#666' }}>Sem foto</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Fotos - Laterais (segunda linha) */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '6px',
          marginBottom: '8px'
        }}>
          {['left', 'right'].map(position => (
            <div key={position} style={{ 
              border: '1px solid #000', 
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{ 
                backgroundColor: '#f0f0f0', 
                padding: '3px 8px', 
                borderBottom: '1px solid #000',
                fontWeight: 'bold',
                fontSize: '9px',
                textAlign: 'center'
              }}>
                {photoLabels[position]}
              </div>
              <div style={{ 
                height: '50mm', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                backgroundColor: '#fafafa',
                padding: '4px'
              }}>
                {inspection[`photo_${position}`] ? (
                  <img 
                    src={getPhotoUrl(inspection[`photo_${position}`])} 
                    alt={photoLabels[position]}
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'contain'
                    }}
                  />
                ) : (
                  <span style={{ fontSize: '9px', color: '#666' }}>Sem foto</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Rodapé */}
        <div style={{ 
          borderTop: '1px solid #000',
          paddingTop: '6px',
          fontSize: '9px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', flex: 1 }}>
              <div>
                <strong>Vistoriado por:</strong> {inspection.created_by_name}
              </div>
              <div>
                <strong>Data de criação:</strong> {format(new Date(inspection.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </div>
              <div>
                <strong>Data da vistoria:</strong> {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </div>
            </div>
            {barcodeImage && (
              <div style={{ textAlign: 'right' }}>
                <img src={barcodeImage} alt="Código de Barras" style={{ height: '45px', width: 'auto' }} />
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center', fontSize: '8px', color: '#666', borderTop: '1px solid #ddd', paddingTop: '4px' }}>
            J.A LOGÍSTICA - Logística e Armazenagem | Este documento é válido como vistoria de container
          </div>
        </div>
      </div>
    </div>
  );

  const renderPhotoSection = (position, isLarge = false) => {
    const photo = inspection[`photo_${position}`];
    const label = photoLabels[position];
    
    return (
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold">{label}</h4>
          {photo && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDownloadPhoto(photo, label)}
            >
              <Download className="w-4 h-4 mr-1" />
              Baixar
            </Button>
          )}
        </div>
        
        {photo ? (
          <div className="relative">
            <img
              src={getPhotoUrl(photo)}
              alt={label}
              className={`w-full ${isLarge ? 'h-64' : 'h-48'} object-contain rounded-lg bg-gray-50`}
            />
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => handlePhotoDelete(position)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className={`${isLarge ? 'h-64' : 'h-48'} border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 bg-gray-50`}>
            {uploading[position] ? (
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => fileInputRefs[position].current?.click()}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Importar
                </Button>
                <input
                  ref={fileInputRefs[position]}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePhotoUpload(position, file);
                  }}
                />
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Layout>
      {/* Área de impressão */}
      <PrintView />

      {/* Conteúdo da tela */}
      <div className="max-w-5xl mx-auto no-print" data-testid="container-inspection-detail-page">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate('/container-inspections')} data-testid="back-btn">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar
            </Button>
            <div>
              <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
                Vistoria #{inspection.inspection_number}
              </h1>
              <p className="text-muted-foreground mt-1">
                Criado em {format(new Date(inspection.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/container-inspections/${id}/edit`)} data-testid="edit-btn">
              <Edit className="w-4 h-4 mr-2" />
              Editar
            </Button>
            <Button variant="outline" onClick={() => window.print()} data-testid="print-btn">
              <Printer className="w-4 h-4 mr-2" />
              Imprimir
            </Button>
          </div>
        </div>

        {/* Informações */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Informações do Container</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Número do Container</p>
                <p className="font-semibold">{inspection.container_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Numeração do Container</p>
                <p className="font-semibold">{inspection.container_seal || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Terminal de Coleta</p>
                <p className="font-semibold">{inspection.collection_terminal || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Booking</p>
                <p className="font-semibold">{inspection.booking || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cliente</p>
                <p className="font-semibold">{inspection.client_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Armador</p>
                <p className="font-semibold">{inspection.shipping_line_name || '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Observações */}
        {inspection.observations && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Observações</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">{inspection.observations}</p>
            </CardContent>
          </Card>
        )}

        {/* Fotos - Frente, Traseira, Interno */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Frente, Traseira e Interno
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {renderPhotoSection('front', true)}
              {renderPhotoSection('back', true)}
              {renderPhotoSection('internal', true)}
            </div>
          </CardContent>
        </Card>

        {/* Fotos - Laterais */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Laterais
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {renderPhotoSection('left')}
              {renderPhotoSection('right')}
            </div>
          </CardContent>
        </Card>

        {/* Metadados e Código de Barras */}
        <Card>
          <CardHeader>
            <CardTitle>Informações da Vistoria</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-start">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 flex-1">
                <div>
                  <p className="text-sm text-muted-foreground">Criado por</p>
                  <p className="font-semibold">{inspection.created_by_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Data de Criação</p>
                  <p className="font-semibold">
                    {format(new Date(inspection.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
                {inspection.updated_at && (
                  <div>
                    <p className="text-sm text-muted-foreground">Última Atualização</p>
                    <p className="font-semibold">
                      {format(new Date(inspection.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                )}
              </div>
              {barcodeImage && (
                <div className="text-center ml-4">
                  <p className="text-sm text-muted-foreground mb-1">Código de Barras</p>
                  <img src={barcodeImage} alt="Código de Barras" className="h-12" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
