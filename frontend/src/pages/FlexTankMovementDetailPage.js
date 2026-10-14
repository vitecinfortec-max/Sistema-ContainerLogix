import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { PageSkeleton } from '../components/DataPage';
import PageHeader from '../components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Edit, Trash2, Loader2, Package } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function FlexTankMovementDetailPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { id } = useParams();
  const navigate = useNavigate();
  const [movement, setMovement] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMovement();
  }, [id]);

  const loadMovement = async () => {
    try {
      const response = await api.getFlexTankMovement(id);
      setMovement(response.data);
    } catch (error) {
      toast.error('Erro ao carregar movimentação');
      navigate('/flex-tank');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!(await confirm('Tem certeza que deseja excluir esta movimentação?'))) return;
    
    try {
      await api.deleteFlexTankMovement(id);
      toast.success('Movimentação excluída com sucesso!');
      navigate('/flex-tank');
    } catch (error) {
      toast.error('Erro ao excluir movimentação');
    }
  };

  if (loading) {
    return (
      <Layout>
        <PageSkeleton />
      </Layout>
    );
  }

  if (!movement) {
    return (
      <Layout>
        <div className="text-center py-8">Movimentação não encontrada</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto" data-testid="flex-tank-movement-detail-page">
        <div className="mb-4">
          <PageHeader
            icon={Package}
            title={<>Movimentação #{movement.movement_number}</>}
            subtitle={<>Registrado em {format(new Date(movement.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</>}
            backTo={'/flex-tank'}
            backTestId="back-btn"
            actions={(
              <>
                <Button variant="outline" onClick={() => navigate(`/flex-tank/movements/${id}/edit`)} data-testid="edit-btn">
                  <Edit className="w-4 h-4 mr-2" />
                  Editar
                </Button>
                <Button variant="destructive" onClick={handleDelete} data-testid="delete-btn">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Excluir
                </Button>
              </>
            )}
          />
        </div>

        <Card className="mb-4 border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              Dados da Movimentação
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Número da Bolsa</p>
                <p className="font-semibold text-lg">{movement.bag_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tamanho da Bolsa</p>
                <p className="font-semibold text-lg">{movement.bag_size}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Data</p>
                <p className="font-semibold text-lg">
                  {format(new Date(movement.movement_date), "dd/MM/yyyy", { locale: ptBR })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tipo</p>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  movement.movement_type === 'ENTRADA' 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : 'bg-red-100 text-red-800'
                }`}>
                  {movement.movement_type}
                </span>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cliente</p>
                <p className="font-semibold text-lg">{movement.client_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Número do Container</p>
                <p className="font-semibold text-lg">{movement.container_number || '-'}</p>
              </div>
              {movement.destination_client_name && (
                <div>
                  <p className="text-sm text-muted-foreground">Cliente Destino</p>
                  <p className="font-semibold text-lg text-blue-600">{movement.destination_client_name}</p>
                </div>
              )}
            </div>
            
            {movement.observations && (
              <div className="mt-6 pt-6 border-t">
                <p className="text-sm text-muted-foreground mb-2">Observações</p>
                <p className="whitespace-pre-wrap">{movement.observations}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Registro</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Registrado por</p>
                <p className="font-semibold">{movement.created_by_name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Data de Registro</p>
                <p className="font-semibold">
                  {format(new Date(movement.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </p>
              </div>
              {movement.updated_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Última Atualização</p>
                  <p className="font-semibold">
                    {format(new Date(movement.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
