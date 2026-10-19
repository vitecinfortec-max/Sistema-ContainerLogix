import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, StatusPill, EmptyState, TablePagination, UserTag,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toast } from 'sonner';
import { History, ListTree } from 'lucide-react';
import { format } from 'date-fns';
import { calendarDate } from '../lib/dates';

const PAGE_SIZE = 30;

const ACTIONS = {
  create: { label: 'Criou', tone: 'emerald' },
  update: { label: 'Alterou', tone: 'blue' },
  update_many: { label: 'Alterou em lote', tone: 'violet' },
  delete: { label: 'Excluiu', tone: 'red' },
};

// Nome em português dos campos mais comuns; os demais aparecem como gravados
const FIELD_LABELS = {
  status: 'Status', name: 'Nome', email: 'E-mail', role: 'Perfil', active: 'Ativo',
  amount: 'Valor', value: 'Valor', total_value: 'Valor total', total: 'Total', price: 'Preço',
  sale_value: 'Valor da venda', purchase_value: 'Valor da compra', received_value: 'Valor recebido',
  quantity: 'Quantidade', unit_price: 'Preço unitário', discount: 'Desconto',
  client_name: 'Cliente', client_id: 'Cliente (id)', supplier_name: 'Fornecedor', payee: 'Favorecido',
  driver_name: 'Motorista', vehicle_plate: 'Placa', plate: 'Placa', container_number: 'Container',
  invoice_number: 'Nº da fatura', request_number: 'Nº', check_number: 'Nº do cheque', order_number: 'Nº da ordem',
  bank: 'Banco', agency: 'Agência', account: 'Conta', bank_name: 'Banco', bank_agency: 'Agência', bank_account: 'Conta',
  description: 'Descrição', observations: 'Observações', notes: 'Observações',
  issue_date: 'Data de emissão', due_date: 'Vencimento', payment_date: 'Data de pagamento', paid_at: 'Pago em',
  compensation_date: 'Compensação', return_reason: 'Motivo da devolução', departure_date: 'Data de saída',
  operation_type: 'Operação', billed: 'Faturado', invoice_id: 'Fatura (id)', items: 'Itens',
  created_at: 'Criado em', created_by: 'Criado por (id)', created_by_name: 'Criado por', history: 'Histórico',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '(vazio)';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return value.toLocaleString('pt-BR');
  if (typeof value === 'string') {
    if (ISO_DAY.test(value)) return format(calendarDate(value), 'dd/MM/yyyy');
    if (ISO_DATETIME.test(value)) return format(new Date(value), 'dd/MM/yyyy HH:mm');
    return value;
  }
  return JSON.stringify(value, null, 1);
}

const fieldLabel = (key) => FIELD_LABELS[key] || key;
const formatAt = (value) => (value ? format(new Date(value), 'dd/MM/yyyy HH:mm:ss') : '-');

function ActionPill({ action }) {
  const info = ACTIONS[action] || { label: action, tone: 'slate' };
  return <StatusPill tone={info.tone}>{info.label}</StatusPill>;
}

function ValueCell({ value }) {
  const text = formatValue(value);
  return <span className={typeof value === 'object' && value !== null ? 'font-mono text-xs whitespace-pre-wrap break-all' : 'break-words'}>{text}</span>;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [options, setOptions] = useState({ users: [], areas: [] });

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [area, setArea] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery.trim());

  const [detail, setDetail] = useState(null);
  const [recordHistory, setRecordHistory] = useState(null);

  useEffect(() => {
    api.getAuditLogFilters().then((res) => setOptions(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const params = { page: pagination.page, per_page: PAGE_SIZE };
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
        if (userId) params.user_id = userId;
        if (action) params.action = action;
        if (area) params.area = area;
        if (debouncedSearch) params.search = debouncedSearch;
        const res = await api.getAuditLog(params);
        setEntries(res.data.items);
        setPagination((prev) => ({ ...prev, pages: res.data.pages, total: res.data.total }));
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Erro ao carregar o log');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [pagination.page, dateFrom, dateTo, userId, action, area, debouncedSearch]);

  const changeFilter = (setter) => (value) => {
    setter(value === 'ALL' ? '' : value);
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setUserId(''); setAction(''); setArea(''); setSearchQuery('');
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const hasFilters = !!(dateFrom || dateTo || userId || action || area || searchQuery);

  const openDetail = async (entry) => {
    setRecordHistory(null);
    try {
      const res = await api.getAuditLogEntry(entry.id);
      setDetail(res.data);
    } catch (error) {
      toast.error('Erro ao abrir o registro do log');
    }
  };

  const loadRecordHistory = async () => {
    try {
      const res = await api.getRecordHistory(detail.doc_id);
      setRecordHistory(res.data);
    } catch (error) {
      toast.error('Erro ao carregar o histórico do registro');
    }
  };

  const summaryText = (entry) => {
    if (entry.action === 'update') return entry.changed_fields.map(fieldLabel).join(', ');
    if (entry.action === 'update_many') return `${entry.count} registro(s)`;
    return '';
  };

  const dataRows = detail?.data
    ? Object.entries(detail.data).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    : [];

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader icon={History} title="Log de Auditoria" subtitle="Quem criou, alterou ou excluiu cada lançamento, e quando" />

        <FilterCard hasFilters={hasFilters} onClear={clearFilters}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="De">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => changeFilter(setDateFrom)(e.target.value)} />
            </FilterField>
            <FilterField label="Até">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => changeFilter(setDateTo)(e.target.value)} />
            </FilterField>
            <FilterField label="Usuário">
              <Select value={userId || 'ALL'} onValueChange={changeFilter(setUserId)}>
                <SelectTrigger className="h-9 text-sm" data-testid="audit-filter-user"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {options.users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Ação">
              <Select value={action || 'ALL'} onValueChange={changeFilter(setAction)}>
                <SelectTrigger className="h-9 text-sm" data-testid="audit-filter-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {Object.entries(ACTIONS).map(([key, info]) => <SelectItem key={key} value={key}>{info.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Área">
              <Select value={area || 'ALL'} onValueChange={changeFilter(setArea)}>
                <SelectTrigger className="h-9 text-sm" data-testid="audit-filter-area"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {options.areas.map((a) => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Registro (nº, container, nome...)">
              <SearchInput value={searchQuery} onChange={(e) => changeFilter(setSearchQuery)(e.target.value)} data-testid="audit-search" />
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Registros"
          count={pagination.total}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nenhum registro no log"
              hint={hasFilters ? 'Ajuste os filtros' : 'As criações, alterações e exclusões feitas a partir de agora aparecem aqui'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data/hora</th>
                    <th>Usuário</th>
                    <th>Ação</th>
                    <th>Área</th>
                    <th>Registro</th>
                    <th>Campos alterados</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="cursor-pointer" onClick={() => openDetail(entry)} data-testid="audit-row">
                      <td className="whitespace-nowrap tabular-nums">{formatAt(entry.at)}</td>
                      <td><UserTag name={entry.user_name} /></td>
                      <td><ActionPill action={entry.action} /></td>
                      <td className="whitespace-nowrap">{entry.area}</td>
                      <td className="cell-strong">{entry.label || '-'}</td>
                      <td className="text-xs text-muted-foreground max-w-[320px] truncate" title={summaryText(entry)}>{summaryText(entry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {detail && <ActionPill action={detail.action} />}
              {detail?.area}{detail?.label ? ` · ${detail.label}` : ''}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><p className="text-xs text-muted-foreground">Data/hora</p><p className="font-medium tabular-nums">{formatAt(detail.at)}</p></div>
                <div><p className="text-xs text-muted-foreground">Usuário</p><p className="font-medium">{detail.user_name}</p></div>
                <div><p className="text-xs text-muted-foreground">IP</p><p className="font-medium">{detail.ip || '-'}</p></div>
                <div><p className="text-xs text-muted-foreground">Operação</p><p className="font-mono text-xs break-all">{detail.method} {detail.path}</p></div>
              </div>

              {detail.action === 'update' && (
                <table className="data-table">
                  <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
                  <tbody>
                    {Object.entries(detail.changes || {}).map(([key, change]) => (
                      <tr key={key}>
                        <td className="cell-strong whitespace-nowrap">{fieldLabel(key)}</td>
                        <td className="text-red-700 dark:text-red-400"><ValueCell value={change.from} /></td>
                        <td className="text-emerald-700 dark:text-emerald-400"><ValueCell value={change.to} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {(detail.action === 'create' || detail.action === 'delete') && (
                <div>
                  <h4 className="font-semibold mb-2">{detail.action === 'delete' ? 'Conteúdo do registro excluído' : 'Registro criado'}</h4>
                  <table className="data-table">
                    <tbody>
                      {dataRows.map(([key, value]) => (
                        <tr key={key}>
                          <td className="cell-strong whitespace-nowrap align-top w-1/3">{fieldLabel(key)}</td>
                          <td><ValueCell value={value} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detail.action === 'update_many' && (
                <div className="space-y-2">
                  <p>{detail.count} registro(s) alterados de uma vez.</p>
                  <pre className="rounded bg-muted/50 p-3 text-xs whitespace-pre-wrap break-all">{JSON.stringify({ filtro: detail.filter, alteracao: detail.update }, null, 2)}</pre>
                </div>
              )}

              {recordHistory && (
                <div>
                  <h4 className="font-semibold mb-2">Tudo o que aconteceu com este registro</h4>
                  <ol className="space-y-2 border-l border-slate-200 dark:border-slate-700 pl-4">
                    {recordHistory.map((h) => (
                      <li key={h.id} className="flex flex-wrap items-center gap-2">
                        <ActionPill action={h.action} />
                        <span className="tabular-nums text-muted-foreground">{formatAt(h.at)}</span>
                        <UserTag name={h.user_name} />
                        {h.action === 'update' && <span className="text-muted-foreground">· {h.changed_fields.map(fieldLabel).join(', ')}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {detail?.doc_id && !recordHistory && (
              <Button variant="outline" onClick={loadRecordHistory} data-testid="audit-record-history">
                <ListTree className="w-4 h-4 mr-1.5" /> Histórico do registro
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetail(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
