import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { sanitizeKmInput } from '../lib/utils';
import { toast } from 'sonner';
import { Fuel } from 'lucide-react';

const EMPTY_FORM = { capacity_liters: '', minimum_alert_liters: '' };

export default function TankSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await api.getTankSettings();
      const data = response.data || {};
      setFormData({
        capacity_liters: data.capacity_liters ?? '',
        minimum_alert_liters: data.minimum_alert_liters ?? '',
      });
    } catch (error) {
      toast.error('Erro ao carregar configuração do tanque');
    } finally {
      setLoading(false);
    }
  };

  const setField = (field, value) => {
    const v = sanitizeKmInput(value);
    if (v !== null) setFormData(prev => ({ ...prev, [field]: v }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!formData.capacity_liters || !formData.minimum_alert_liters) {
      toast.error('Preencha a Capacidade e o Alerta Mínimo');
      return;
    }
    setSaving(true);
    try {
      await api.updateTankSettings({
        capacity_liters: Number(formData.capacity_liters),
        minimum_alert_liters: Number(formData.minimum_alert_liters),
      });
      toast.success('Configuração do tanque salva com sucesso');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar configuração do tanque');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="tank-settings-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="tank-settings-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Configuração de Tanque</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
            Define a capacidade do tanque próprio e o litro mínimo pra disparar o alerta em "Nível do Tanque"
          </p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none max-w-xl">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Fuel className="w-4 h-4" />
              Tanque Próprio
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Capacidade do Tanque (litros) *</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={formData.capacity_liters}
                    onChange={(e) => setField('capacity_liters', e.target.value)}
                    className="h-10 text-[13px]"
                    data-testid="tank-capacity-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">Alerta Mínimo (litros) *</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={formData.minimum_alert_liters}
                    onChange={(e) => setField('minimum_alert_liters', e.target.value)}
                    className="h-10 text-[13px]"
                    data-testid="tank-minimum-input"
                  />
                </div>
              </div>
              <Button type="submit" className="text-[13px] font-semibold" disabled={saving} data-testid="save-tank-settings-button">
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
