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

export default function PhotoRegistryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState({});
  const [barcodeImage, setBarcodeImage] = useState(null);
  const printTriggered = useRef(false);
  
  const fileInputRefs = {
    front: useRef(null),
    back: useRef(null),
    left: useRef(null),
    right: useRef(null)
  };

  useEffect(() => {
    loadRegistry();
  }, [id]);

  useEffect(() => {
    if (registry) {
      // Gerar código de barras baseado no número do registro
      const barcodeValue = `RF${String(registry.registry_number).padStart(6, '0')}`;
      const barcodeImg = generateBarcodeImage(barcodeValue);
      setBarcodeImage(barcodeImg);
    }
  }, [registry]);

  useEffect(() => {
    if (searchParams.get('print') === 'true' && registry && !printTriggered.current) {
      printTriggered.current = true;
      setTimeout(() => window.print(), 500);
    }
  }, [registry, searchParams]);

  const loadRegistry = async () => {
    try {
      const response = await api.getPhotoRegistry(id);
      setRegistry(response.data);
    } catch (error) {
      toast.error('Erro ao carregar registro');
      navigate('/photo-registries');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (position, file) => {
    if (!file) return;
    
    setUploading(prev => ({ ...prev, [position]: true }));
    
    try {
      await api.uploadPhotoRegistryPhoto(id, position, file);
      toast.success('Foto enviada com sucesso!');
      loadRegistry();
    } catch (error) {
      toast.error('Erro ao enviar foto');
    } finally {
      setUploading(prev => ({ ...prev, [position]: false }));
    }
  };

  const handlePhotoDelete = async (position) => {
    try {
      await api.deletePhotoRegistryPhoto(id, position);
      toast.success('Foto removida com sucesso!');
      loadRegistry();
    } catch (error) {
      toast.error('Erro ao remover foto');
    }
  };

  const handlePhotoCapture = async (position) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      
      await new Promise(resolve => {
        video.onloadedmetadata = resolve;
      });
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      stream.getTracks().forEach(track => track.stop());
      
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      const file = new File([blob], `${position}.jpg`, { type: 'image/jpeg' });
      
      await handlePhotoUpload(position, file);
    } catch (error) {
      console.error('Erro ao capturar foto:', error);
      toast.error('Erro ao acessar câmera. Tente importar uma imagem.');
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
      a.download = `${registry.container_number}_${label.replace(/\s+/g, '_')}.jpg`;
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

  const photoPositions = [
    { key: 'front', label: 'Frente', field: 'photo_front' },
    { key: 'back', label: 'Traseira', field: 'photo_back' },
    { key: 'left', label: 'Lateral Esquerda', field: 'photo_left' },
    { key: 'right', label: 'Lateral Direita', field: 'photo_right' }
  ];

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!registry) {
    return (
      <Layout>
        <div className="text-center py-8">Registro não encontrado</div>
      </Layout>
    );
  }

  // Componente de impressão com layout ajustado
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
            src="/logo-containerlogix.png"
            alt="ContainerLogix"
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
            REGISTRO FOTOGRÁFICO DE CONTÊINER
          </div>
          <div style={{ fontSize: '11px', color: '#000', marginTop: '2px' }}>
            Registro Nº {registry.registry_number}
          </div>
        </div>

        {/* Informações */}
        <div style={{ 
          border: '1px solid #000', 
          borderRadius: '4px', 
          marginBottom: '10px',
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
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{registry.container_number}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Numeração do Container</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{registry.container_seal || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Terminal de Coleta</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{registry.collection_terminal || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Booking</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{registry.booking || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Cliente</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{registry.client_name || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Armador</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{registry.shipping_line_name || '-'}</div>
            </div>
          </div>
        </div>

        {/* Fotos - Frente e Traseira (Horizontal/Landscape) */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '8px',
          marginBottom: '8px'
        }}>
          {/* Frente */}
          <div style={{ 
            border: '1px solid #000', 
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              backgroundColor: '#f0f0f0', 
              padding: '3px 8px', 
              borderBottom: '1px solid #000',
              fontWeight: 'bold',
              fontSize: '10px',
              textAlign: 'center'
            }}>
              Frente
            </div>
            <div style={{ 
              height: '75mm', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              backgroundColor: '#fafafa',
              padding: '4px'
            }}>
              {registry.photo_front ? (
                <img 
                  src={getPhotoUrl(registry.photo_front)} 
                  alt="Frente"
                  style={{ 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'contain'
                  }}
                />
              ) : (
                <span style={{ fontSize: '10px', color: '#666' }}>Sem foto</span>
              )}
            </div>
          </div>

          {/* Traseira */}
          <div style={{ 
            border: '1px solid #000', 
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              backgroundColor: '#f0f0f0', 
              padding: '3px 8px', 
              borderBottom: '1px solid #000',
              fontWeight: 'bold',
              fontSize: '10px',
              textAlign: 'center'
            }}>
              Traseira
            </div>
            <div style={{ 
              height: '75mm', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              backgroundColor: '#fafafa',
              padding: '4px'
            }}>
              {registry.photo_back ? (
                <img 
                  src={getPhotoUrl(registry.photo_back)} 
                  alt="Traseira"
                  style={{ 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'contain'
                  }}
                />
              ) : (
                <span style={{ fontSize: '10px', color: '#666' }}>Sem foto</span>
              )}
            </div>
          </div>
        </div>

        {/* Fotos - Laterais (Vertical/Portrait - maiores) */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '8px',
          marginBottom: '8px'
        }}>
          {/* Lateral Esquerda */}
          <div style={{ 
            border: '1px solid #000', 
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              backgroundColor: '#f0f0f0', 
              padding: '3px 8px', 
              borderBottom: '1px solid #000',
              fontWeight: 'bold',
              fontSize: '10px',
              textAlign: 'center'
            }}>
              Lateral Esquerda
            </div>
            <div style={{ 
              height: '65mm', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              backgroundColor: '#fafafa',
              padding: '4px'
            }}>
              {registry.photo_left ? (
                <img 
                  src={getPhotoUrl(registry.photo_left)} 
                  alt="Lateral Esquerda"
                  style={{ 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'contain'
                  }}
                />
              ) : (
                <span style={{ fontSize: '10px', color: '#666' }}>Sem foto</span>
              )}
            </div>
          </div>

          {/* Lateral Direita */}
          <div style={{ 
            border: '1px solid #000', 
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              backgroundColor: '#f0f0f0', 
              padding: '3px 8px', 
              borderBottom: '1px solid #000',
              fontWeight: 'bold',
              fontSize: '10px',
              textAlign: 'center'
            }}>
              Lateral Direita
            </div>
            <div style={{ 
              height: '65mm', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              backgroundColor: '#fafafa',
              padding: '4px'
            }}>
              {registry.photo_right ? (
                <img 
                  src={getPhotoUrl(registry.photo_right)} 
                  alt="Lateral Direita"
                  style={{ 
                    width: '100%', 
                    height: '100%', 
                    objectFit: 'contain'
                  }}
                />
              ) : (
                <span style={{ fontSize: '10px', color: '#666' }}>Sem foto</span>
              )}
            </div>
          </div>
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
                <strong>Criado por:</strong> {registry.created_by_name}
              </div>
              <div>
                <strong>Data de criação:</strong> {format(new Date(registry.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </div>
              <div>
                <strong>Data de emissão:</strong> {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </div>
            </div>
            {barcodeImage && (
              <div style={{ textAlign: 'right' }}>
                <img src={barcodeImage} alt="Código de Barras" style={{ height: '45px', width: 'auto' }} />
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center', fontSize: '8px', color: '#666', borderTop: '1px solid #ddd', paddingTop: '4px' }}>
            J.A LOGÍSTICA - Logística e Armazenagem | Este documento é válido como registro fotográfico
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Layout>
      {/* Área de impressão */}
      <PrintView />

      {/* Conteúdo da tela */}
      <div className="max-w-5xl mx-auto no-print" data-testid="photo-registry-detail-page">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate('/photo-registries')} data-testid="back-btn">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar
            </Button>
            <div>
              <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
                Registro Fotográfico #{registry.registry_number}
              </h1>
              <p className="text-muted-foreground mt-1">
                Criado em {format(new Date(registry.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/photo-registries/${id}/edit`)} data-testid="edit-btn">
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
                <p className="font-semibold">{registry.container_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Numeração do Container</p>
                <p className="font-semibold">{registry.container_seal || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Terminal de Coleta</p>
                <p className="font-semibold">{registry.collection_terminal || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Booking</p>
                <p className="font-semibold">{registry.booking || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cliente</p>
                <p className="font-semibold">{registry.client_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Armador</p>
                <p className="font-semibold">{registry.shipping_line_name || '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fotos - Frente e Traseira (formato horizontal maior) */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Frente e Traseira
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Frente */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold">Frente</h4>
                  {registry.photo_front && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadPhoto(registry.photo_front, 'Frente')}
                      data-testid="download-front-btn"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Baixar
                    </Button>
                  )}
                </div>
                
                {registry.photo_front ? (
                  <div className="relative">
                    <img
                      src={getPhotoUrl(registry.photo_front)}
                      alt="Frente"
                      className="w-full h-64 object-contain rounded-lg bg-gray-50"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2"
                      onClick={() => handlePhotoDelete('front')}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="h-64 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 bg-gray-50">
                    {uploading.front ? (
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => handlePhotoCapture('front')}
                            data-testid="capture-front-btn"
                          >
                            <Camera className="w-4 h-4 mr-2" />
                            Tirar Foto
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => fileInputRefs.front.current?.click()}
                            data-testid="upload-front-btn"
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            Importar
                          </Button>
                        </div>
                        <input
                          ref={fileInputRefs.front}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePhotoUpload('front', file);
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Traseira */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold">Traseira</h4>
                  {registry.photo_back && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadPhoto(registry.photo_back, 'Traseira')}
                      data-testid="download-back-btn"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Baixar
                    </Button>
                  )}
                </div>
                
                {registry.photo_back ? (
                  <div className="relative">
                    <img
                      src={getPhotoUrl(registry.photo_back)}
                      alt="Traseira"
                      className="w-full h-64 object-contain rounded-lg bg-gray-50"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2"
                      onClick={() => handlePhotoDelete('back')}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="h-64 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 bg-gray-50">
                    {uploading.back ? (
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => handlePhotoCapture('back')}
                            data-testid="capture-back-btn"
                          >
                            <Camera className="w-4 h-4 mr-2" />
                            Tirar Foto
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => fileInputRefs.back.current?.click()}
                            data-testid="upload-back-btn"
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            Importar
                          </Button>
                        </div>
                        <input
                          ref={fileInputRefs.back}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePhotoUpload('back', file);
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fotos - Laterais (formato vertical) */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Laterais
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Lateral Esquerda */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold">Lateral Esquerda</h4>
                  {registry.photo_left && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadPhoto(registry.photo_left, 'Lateral_Esquerda')}
                      data-testid="download-left-btn"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Baixar
                    </Button>
                  )}
                </div>
                
                {registry.photo_left ? (
                  <div className="relative">
                    <img
                      src={getPhotoUrl(registry.photo_left)}
                      alt="Lateral Esquerda"
                      className="w-full h-56 object-contain rounded-lg bg-gray-50"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2"
                      onClick={() => handlePhotoDelete('left')}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="h-56 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 bg-gray-50">
                    {uploading.left ? (
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => handlePhotoCapture('left')}
                            data-testid="capture-left-btn"
                          >
                            <Camera className="w-4 h-4 mr-2" />
                            Tirar Foto
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => fileInputRefs.left.current?.click()}
                            data-testid="upload-left-btn"
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            Importar
                          </Button>
                        </div>
                        <input
                          ref={fileInputRefs.left}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePhotoUpload('left', file);
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Lateral Direita */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold">Lateral Direita</h4>
                  {registry.photo_right && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadPhoto(registry.photo_right, 'Lateral_Direita')}
                      data-testid="download-right-btn"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Baixar
                    </Button>
                  )}
                </div>
                
                {registry.photo_right ? (
                  <div className="relative">
                    <img
                      src={getPhotoUrl(registry.photo_right)}
                      alt="Lateral Direita"
                      className="w-full h-56 object-contain rounded-lg bg-gray-50"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2"
                      onClick={() => handlePhotoDelete('right')}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="h-56 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 bg-gray-50">
                    {uploading.right ? (
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => handlePhotoCapture('right')}
                            data-testid="capture-right-btn"
                          >
                            <Camera className="w-4 h-4 mr-2" />
                            Tirar Foto
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => fileInputRefs.right.current?.click()}
                            data-testid="upload-right-btn"
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            Importar
                          </Button>
                        </div>
                        <input
                          ref={fileInputRefs.right}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handlePhotoUpload('right', file);
                          }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Metadados e Código de Barras */}
        <Card>
          <CardHeader>
            <CardTitle>Informações do Registro</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-start">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 flex-1">
                <div>
                  <p className="text-sm text-muted-foreground">Criado por</p>
                  <p className="font-semibold">{registry.created_by_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Data de Criação</p>
                  <p className="font-semibold">
                    {format(new Date(registry.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
                {registry.updated_at && (
                  <div>
                    <p className="text-sm text-muted-foreground">Última Atualização</p>
                    <p className="font-semibold">
                      {format(new Date(registry.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
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
