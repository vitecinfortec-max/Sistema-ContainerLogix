import axios from 'axios';
import './tenant'; // empresa em toda chamada (multi-cliente)

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const BASE_URL = process.env.REACT_APP_BACKEND_URL;

const token = sessionStorage.getItem('token');
if (token) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export const api = {
  getDashboardStats: () => axios.get(`${API}/dashboard`),
  // Tela de login: de qual empresa é este endereço (nome e logo)
  getTenantInfo: () => axios.get(`${API}/tenant-info`),
  
  // Drivers
  getDrivers: () => axios.get(`${API}/drivers`),
  createDriver: (data) => axios.post(`${API}/drivers`, data),
  updateDriver: (id, data) => axios.put(`${API}/drivers/${id}`, data),
  deleteDriver: (id) => axios.delete(`${API}/drivers/${id}`),
  
  // Transport Companies
  getTransportCompanies: () => axios.get(`${API}/transport-companies`),
  getCompanies: () => axios.get(`${API}/transport-companies`),
  createTransportCompany: (data) => axios.post(`${API}/transport-companies`, data),
  updateTransportCompany: (id, data) => axios.put(`${API}/transport-companies/${id}`, data),
  deleteTransportCompany: (id) => axios.delete(`${API}/transport-companies/${id}`),
  
  // Shipping Lines
  getShippingLines: () => axios.get(`${API}/shipping-lines`),
  createShippingLine: (data) => axios.post(`${API}/shipping-lines`, data),
  updateShippingLine: (id, data) => axios.put(`${API}/shipping-lines/${id}`, data),
  deleteShippingLine: (id) => axios.delete(`${API}/shipping-lines/${id}`),
  
  // Clients
  getClients: (params) => axios.get(`${API}/clients`, { params }),
  createClient: (data) => axios.post(`${API}/clients`, data),
  updateClient: (id, data) => axios.put(`${API}/clients/${id}`, data),
  deleteClient: (id) => axios.delete(`${API}/clients/${id}`),

  // Suppliers (Fornecedores)
  getSuppliers: () => axios.get(`${API}/suppliers`),
  createSupplier: (data) => axios.post(`${API}/suppliers`, data),
  updateSupplier: (id, data) => axios.put(`${API}/suppliers/${id}`, data),
  deleteSupplier: (id) => axios.delete(`${API}/suppliers/${id}`),

  getWarehouses: () => axios.get(`${API}/warehouses`),
  createWarehouse: (data) => axios.post(`${API}/warehouses`, data),
  updateWarehouse: (id, data) => axios.put(`${API}/warehouses/${id}`, data),
  deleteWarehouse: (id) => axios.delete(`${API}/warehouses/${id}`),

  getProductFamilies: () => axios.get(`${API}/product-families`),
  createProductFamily: (data) => axios.post(`${API}/product-families`, data),
  updateProductFamily: (id, data) => axios.put(`${API}/product-families/${id}`, data),
  deleteProductFamily: (id) => axios.delete(`${API}/product-families/${id}`),

  getServiceFamilies: () => axios.get(`${API}/service-families`),
  createServiceFamily: (data) => axios.post(`${API}/service-families`, data),
  updateServiceFamily: (id, data) => axios.put(`${API}/service-families/${id}`, data),
  deleteServiceFamily: (id) => axios.delete(`${API}/service-families/${id}`),

  getServiceCatalog: () => axios.get(`${API}/service-catalog`),
  getServiceCatalogNextCode: () => axios.get(`${API}/service-catalog/next-code`),
  createServiceCatalogItem: (data) => axios.post(`${API}/service-catalog`, data),
  updateServiceCatalogItem: (id, data) => axios.put(`${API}/service-catalog/${id}`, data),
  deleteServiceCatalogItem: (id) => axios.delete(`${API}/service-catalog/${id}`),

  getProducts: (params) => axios.get(`${API}/products`, { params }),
  getProductNextCode: () => axios.get(`${API}/products/next-code`),
  createProduct: (data) => axios.post(`${API}/products`, data),
  updateProduct: (id, data) => axios.put(`${API}/products/${id}`, data),
  deleteProduct: (id) => axios.delete(`${API}/products/${id}`),
  adjustProductStock: (id, data) => axios.post(`${API}/products/${id}/adjust-stock`, data),

  getStockEntries: () => axios.get(`${API}/stock/entries`),
  parseNfeImport: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/stock/nfe-import/parse`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  confirmNfeImport: (data) => axios.post(`${API}/stock/nfe-import/confirm`, data),
  reverseStockEntryImport: (entryId) => axios.post(`${API}/stock/entries/${entryId}/reverse`),

  getStockReportSummary: (params) => axios.get(`${API}/stock/report/summary`, { params }),
  getStockReportByWarehouse: (params) => axios.get(`${API}/stock/report/by-warehouse`, { params }),
  getStockReportItems: (params) => axios.get(`${API}/stock/report/items`, { params }),
  getStockReportExcel: (params) => axios.get(`${API}/stock/report/excel`, { params, responseType: 'blob' }),
  getStockReportPDF: (params) => axios.get(`${API}/stock/report/pdf`, { params, responseType: 'blob' }),

  getStockLedgerSummary: (params) => axios.get(`${API}/stock/ledger/summary`, { params }),
  getStockLedgerRows: (params) => axios.get(`${API}/stock/ledger/rows`, { params }),
  getStockLedgerDailyChart: () => axios.get(`${API}/stock/ledger/daily-chart`),
  getStockLedgerPDF: (params) => axios.get(`${API}/stock/ledger/pdf`, { params, responseType: 'blob' }),
  getStockLedgerExcel: (params) => axios.get(`${API}/stock/ledger/excel`, { params, responseType: 'blob' }),

  getStockMovements: (params) => axios.get(`${API}/stock/movements`, { params }),
  getStockMovementNextNumber: () => axios.get(`${API}/stock/movements/next-number`),
  getStockMovement: (id) => axios.get(`${API}/stock/movements/${id}`),
  createStockMovement: (data) => axios.post(`${API}/stock/movements`, data),
  updateStockMovement: (id, data) => axios.put(`${API}/stock/movements/${id}`, data),
  deleteStockMovement: (id) => axios.delete(`${API}/stock/movements/${id}`),
  getStockMovementPDF: (id) => axios.get(`${API}/stock/movements/${id}/pdf`, { responseType: 'blob' }),
  // Entrega de EPI's (grupo Almoxarifado)
  getEpiDeliveries: (params) => axios.get(`${API}/epi-deliveries`, { params }),
  getEpiDelivery: (id) => axios.get(`${API}/epi-deliveries/${id}`),
  getEpiDeliveryNextNumber: () => axios.get(`${API}/epi-deliveries/next-number`),
  createEpiDelivery: (data) => axios.post(`${API}/epi-deliveries`, data),
  updateEpiDelivery: (id, data) => axios.put(`${API}/epi-deliveries/${id}`, data),
  deleteEpiDelivery: (id) => axios.delete(`${API}/epi-deliveries/${id}`),
  getEpiDeliveryPDF: (id) => axios.get(`${API}/epi-deliveries/${id}/pdf`, { responseType: 'blob' }),
  getEpiFichaPDF: (params) => axios.get(`${API}/epi-deliveries/ficha/pdf`, { params, responseType: 'blob' }),
  // Assinatura de Motorista (kind=motorista) ou Funcionário (kind=funcionario), em data URL
  updatePersonSignature: (kind, id, signature) => axios.put(`${API}/signatures/${kind}/${id}`, { signature }),

  getOSCategories: () => axios.get(`${API}/os-categories`),
  createOSCategory: (data) => axios.post(`${API}/os-categories`, data),
  updateOSCategory: (id, data) => axios.put(`${API}/os-categories/${id}`, data),
  deleteOSCategory: (id) => axios.delete(`${API}/os-categories/${id}`),

  getStates: () => axios.get(`${API}/locations/states`),
  getCitiesByUF: (uf) => axios.get(`${API}/locations/cities`, { params: { uf } }),
  lookupCep: (cep) => axios.get(`${API}/lookup/cep/${cep}`),
  lookupCnpj: (cnpj) => axios.get(`${API}/lookup/cnpj/${cnpj}`),

  getTerminals: () => axios.get(`${API}/terminals`),
  createTerminal: (data) => axios.post(`${API}/terminals`, data),
  updateTerminal: (id, data) => axios.put(`${API}/terminals/${id}`, data),
  deleteTerminal: (id) => axios.delete(`${API}/terminals/${id}`),

  getEmployees: (params) => axios.get(`${API}/employees`, { params }),
  createEmployee: (data) => axios.post(`${API}/employees`, data),
  updateEmployee: (id, data) => axios.put(`${API}/employees/${id}`, data),
  deleteEmployee: (id) => axios.delete(`${API}/employees/${id}`),

  getInsuranceCompanies: () => axios.get(`${API}/insurance-companies`),
  createInsuranceCompany: (data) => axios.post(`${API}/insurance-companies`, data),
  updateInsuranceCompany: (id, data) => axios.put(`${API}/insurance-companies/${id}`, data),
  deleteInsuranceCompany: (id) => axios.delete(`${API}/insurance-companies/${id}`),

  // Service Types
  getServiceTypes: (params) => axios.get(`${API}/service-types`, { params }),
  createServiceType: (data) => axios.post(`${API}/service-types`, data),
  updateServiceType: (id, data) => axios.put(`${API}/service-types/${id}`, data),
  deleteServiceType: (id) => axios.delete(`${API}/service-types/${id}`),

  // Container Repair Services (Tipo de Serviços da Vistoria de Container)
  getContainerRepairServices: () => axios.get(`${API}/container-repair-services`),
  createContainerRepairService: (data) => axios.post(`${API}/container-repair-services`, data),
  deleteContainerRepairService: (id) => axios.delete(`${API}/container-repair-services/${id}`),

  // Movements
  getMovements: (params) => axios.get(`${API}/movements`, { params }),
  createMovement: (data) => axios.post(`${API}/movements`, data),
  getMovement: (id) => axios.get(`${API}/movements/${id}`),
  updateMovement: (id, data) => axios.put(`${API}/movements/${id}`, data),
  deleteMovement: (id) => axios.delete(`${API}/movements/${id}`),
  getOpenEntryForContainer: (containerNumber) => axios.get(`${API}/movements/open-entry/${containerNumber}`),
  getEntryLockedFields: (containerNumber, exitId) => axios.get(`${API}/movements/entry-locked-fields/${containerNumber}`, { params: exitId ? { exit_id: exitId } : {} }),
  getLastMovementForContainer: (containerNumber) => axios.get(`${API}/movements/last-for-container/${containerNumber}`),
  downloadMovementsPdf: (movementIds, via) => axios.post(`${API}/movements/pdf`, { movement_ids: movementIds, via }, { responseType: 'blob' }),
  
  // Reports
  getMovementsReportPreview: (params) => axios.get(`${API}/reports/movements/preview`, { params }),
  downloadPDFReport: (params) => axios.get(`${API}/reports/pdf`, { params, responseType: 'blob' }),
  downloadExcelReport: (params) => axios.get(`${API}/reports/excel`, { params, responseType: 'blob' }),
  sendDailyMovementReports: (targetDate) => axios.post(`${API}/reports/send-daily-movements`, null, { params: targetDate ? { target_date: targetDate } : {} }),
  downloadBillingPDFReport: (params) => axios.get(`${API}/reports/billing/pdf`, { params, responseType: 'blob' }),
  downloadBillingExcelReport: (params) => axios.get(`${API}/reports/billing/excel`, { params, responseType: 'blob' }),
  getBillingDailyChart: () => axios.get(`${API}/reports/billing/daily-chart`),
  previewBillingReport: (params) => axios.get(`${API}/reports/billing/preview`, { params }),
  downloadStorageOveragePdfReport: (params) => axios.get(`${API}/reports/storage-overage/pdf`, { params, responseType: 'blob' }),
  downloadStorageOverageExcelReport: (params) => axios.get(`${API}/reports/storage-overage/excel`, { params, responseType: 'blob' }),
  
  // Yard Control (Controle de Pátio)
  getYardControl: (params) => axios.get(`${API}/yard-control`, { params }),
  getAlertsSummary: () => axios.get(`${API}/alerts/summary`),
  globalSearch: (q) => axios.get(`${API}/search`, { params: { q } }),
  downloadYardControlExcel: (params) => axios.get(`${API}/yard-control/excel`, { params, responseType: 'blob' }),
  downloadYardControlPdf: (params) => axios.get(`${API}/yard-control/pdf`, { params, responseType: 'blob' }),
  registerQuickExit: (data) => axios.post(`${API}/yard-control/quick-exit`, data),
  
  // Billing
  
  // Invoices Domésticas (Faturas)
  getInvoices: (params) => axios.get(`${API}/invoices`, { params }),
  getInvoicesCount: (params) => axios.get(`${API}/invoices/count`, { params }),
  getInvoicesStats: (params) => axios.get(`${API}/invoices/stats`, { params }),
  getInvoice: (id) => axios.get(`${API}/invoices/${id}`),
  createInvoice: (data) => axios.post(`${API}/invoices`, data),
  updateInvoice: (id, data) => axios.put(`${API}/invoices/${id}`, data),
  updateInvoiceStatus: (id, status, paidDate) => axios.put(`${API}/invoices/${id}/status`, null, { params: { status, paid_date: paidDate || undefined } }),
  deleteInvoice: (id) => axios.delete(`${API}/invoices/${id}`),
  getInvoiceMovements: (id) => axios.get(`${API}/invoices/${id}/movements`),
  getInvoiceHistory: (id) => axios.get(`${API}/invoices/${id}/history`),
  getUnbilledMovements: (params) => axios.get(`${API}/movements/unbilled`, { params }),
  findMovementForInvoice: (search) => axios.get(`${API}/movements/find-for-invoice`, { params: { search } }),
  downloadInvoicePdf: (id) => axios.get(`${API}/invoices/${id}/pdf`, { responseType: 'blob' }),
  downloadInvoiceExcel: (id) => axios.get(`${API}/invoices/${id}/excel`, { responseType: 'blob' }),
  
  // Financeiro - Resumo Financeiro (entradas e saídas de todos os módulos)
  getFinancialSummary: (params) => axios.get(`${API}/reports/financial-summary`, { params }),
  downloadFinancialSummaryPdf: (params) => axios.get(`${API}/reports/financial-summary/pdf`, { params, responseType: 'blob' }),
  downloadFinancialSummaryExcel: (params) => axios.get(`${API}/reports/financial-summary/excel`, { params, responseType: 'blob' }),

  // Financeiro - Crédito de Cliente (conta corrente de adiantamentos)
  getClientCreditSummary: () => axios.get(`${API}/client-credits/summary`),
  getClientCreditAccounts: (params) => axios.get(`${API}/client-credits/accounts`, { params }),
  getClientCreditEntries: (params) => axios.get(`${API}/client-credits/entries`, { params }),
  createClientCreditEntry: (data) => axios.post(`${API}/client-credits/entries`, data),
  getClientCreditOpenInvoices: (clientId) => axios.get(`${API}/client-credits/open-invoices`, { params: { client_id: clientId } }),
  applyClientCredit: (data) => axios.post(`${API}/client-credits/apply`, data),
  reverseClientCreditEntry: (id, reason) => axios.post(`${API}/client-credits/entries/${id}/reverse`, { reason }),
  getInvoiceCredits: (invoiceId) => axios.get(`${API}/client-credits/invoice/${invoiceId}`),
  getClientCreditStatement: (clientId, params) => axios.get(`${API}/client-credits/statement/${clientId}`, { params }),
  downloadClientCreditStatementPdf: (clientId, params) => axios.get(`${API}/client-credits/statement/${clientId}/pdf`, { params, responseType: 'blob' }),
  downloadClientCreditStatementExcel: (clientId, params) => axios.get(`${API}/client-credits/statement/${clientId}/excel`, { params, responseType: 'blob' }),

  // Financeiro - Contas a Receber (conferência das Faturas)
  getReceivables: (params) => axios.get(`${API}/reports/receivables`, { params }),
  downloadReceivablesPdf: (params) => axios.get(`${API}/reports/receivables/pdf`, { params, responseType: 'blob' }),
  downloadReceivablesExcel: (params) => axios.get(`${API}/reports/receivables/excel`, { params, responseType: 'blob' }),

  // International Invoices (Faturas Internacionais)
  getIntlInvoices: (params) => axios.get(`${API}/intl-invoices`, { params }),
  getIntlInvoice: (id) => axios.get(`${API}/intl-invoices/${id}`),
  createIntlInvoice: (data) => axios.post(`${API}/intl-invoices`, data),
  updateIntlInvoice: (id, data) => axios.put(`${API}/intl-invoices/${id}`, data),
  updateIntlInvoiceStatus: (id, status) => axios.put(`${API}/intl-invoices/${id}/status?status=${status}`),
  deleteIntlInvoice: (id) => axios.delete(`${API}/intl-invoices/${id}`),
  getIntlInvoiceReceiverData: () => axios.get(`${API}/intl-invoices/receiver-data`),
  getMovementForInvoice: (transactionId) => axios.get(`${API}/intl-invoices/movement/${transactionId}`),
  downloadIntlInvoicePdf: (id) => axios.get(`${API}/intl-invoices/${id}/pdf`, { responseType: 'blob' }),
  
  // User Shortcuts
  getUserShortcuts: () => axios.get(`${API}/user/shortcuts`),
  updateUserShortcuts: (shortcuts) => axios.put(`${API}/user/shortcuts`, { shortcuts }),
  
  // Company Settings (Dados da Empresa)
  getCompanySettings: () => axios.get(`${API}/company-settings`),
  updateCompanySettings: (data) => axios.put(`${API}/company-settings`, data),

  // Gestão de Usuários (admin)
  getUsers: () => axios.get(`${API}/users`),
  // Opções do Sistema - Log de Auditoria
  getAuditLog: (params) => axios.get(`${API}/audit-log`, { params }),
  getAuditLogFilters: () => axios.get(`${API}/audit-log/filters`),
  getAuditLogEntry: (id) => axios.get(`${API}/audit-log/${id}`),
  getRecordHistory: (docId) => axios.get(`${API}/audit-log/record/${docId}`),
  createUser: (data) => axios.post(`${API}/users`, data),
  updateUserRole: (userId, role) => axios.put(`${API}/users/${userId}/role`, { role }),
  updateUserStatus: (userId, active) => axios.put(`${API}/users/${userId}/status`, { active }),
  updateUserProfile: (userId, data) => axios.put(`${API}/users/${userId}`, data),
  resetUserPassword: (userId, data) => axios.put(`${API}/users/${userId}/password`, data),

  // Módulos Contratados (superadmin)
  getModuleConfig: () => axios.get(`${API}/module-config`),
  getModuleCatalog: () => axios.get(`${API}/module-config/catalog`),
  // Painel do dono do sistema (superadmin): empresas atendidas
  getPlatformTenants: () => axios.get(`${API}/platform/tenants`),
  createPlatformTenant: (data) => axios.post(`${API}/platform/tenants`, data),
  updatePlatformTenant: (slug, data) => axios.put(`${API}/platform/tenants/${slug}`, data),
  setPlatformTenantStatus: (slug, status) => axios.put(`${API}/platform/tenants/${slug}/status`, { status }),
  importPlatformTenantUploads: (slug, sourceUrl) => axios.post(`${API}/platform/tenants/${slug}/import-uploads`, { source_url: sourceUrl }),
  getPlatformTenantImport: (slug) => axios.get(`${API}/platform/tenants/${slug}/import-uploads`),
  setPlatformTenantModules: (slug, disabledModules) => axios.put(`${API}/platform/tenants/${slug}/modules`, { disabled_modules: disabledModules }),
  updateModuleConfig: (disabledModules) => axios.put(`${API}/module-config`, { disabled_modules: disabledModules }),

  // File Upload
  uploadFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteFile: (filename) => axios.delete(`${API}/upload/${filename}`),
  // Lê CNH / RG / CRLV (foto ou PDF) e devolve os campos para o cadastro
  readDocument: (kind, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/documents/read`, formData, {
      params: { kind },
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  // Anexos (fotos, recibos) são pedidos pelo navegador direto de um <img>,
  // sem cabeçalho de autorização - o token de arquivos vai na URL. Ver
  // /auth/file-token no backend.
  getFileToken: () => axios.get(`${API}/auth/file-token`),
  getFileUrl: (path) => {
    const url = `${BASE_URL}${path}`;
    let fileToken = null;
    try { fileToken = sessionStorage.getItem('fileToken'); } catch (e) { /* sem storage */ }
    if (!fileToken || !String(path).startsWith('/api/uploads/')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(fileToken)}`;
  },
  // Baixa um anexo pro aparelho com o nome `filename` (sem extensão - vale a
  // do arquivo). cache: 'no-store' porque a foto já foi carregada pelo <img>
  // da tela sem CORS, e o navegador reaproveitava essa cópia do cache (sem
  // Access-Control-Allow-Origin) e bloqueava o download.
  downloadFile: async (path, filename) => {
    const response = await fetch(api.getFileUrl(path), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao baixar o arquivo (${response.status})`);
    const blob = await response.blob();
    const extension = (String(path).split('?')[0].match(/.[a-z0-9]+$/i) || ['.jpg'])[0];
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}${extension}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
  
  // Container Inspections (Registro Fotográfico)
  getContainerInspections: (params) => axios.get(`${API}/container-inspections`, { params }),
  getInspectionsReport: (params) => axios.get(`${API}/reports/container-inspections`, { params }),
  getInspectionsReportPdf: (params) => axios.get(`${API}/reports/container-inspections/pdf`, { params, responseType: 'blob' }),
  getInspectionsReportExcel: (params) => axios.get(`${API}/reports/container-inspections/excel`, { params, responseType: 'blob' }),
  getContainerInspection: (id) => axios.get(`${API}/container-inspections/${id}`),
  getContainerInspectionPDF: (id) => axios.get(`${API}/container-inspections/${id}/pdf`, { responseType: 'blob' }),
  createContainerInspection: (data) => axios.post(`${API}/container-inspections`, data),
  updateContainerInspection: (id, data) => axios.put(`${API}/container-inspections/${id}`, data),
  deleteContainerInspection: (id) => axios.delete(`${API}/container-inspections/${id}`),
  uploadContainerInspectionPhoto: (id, type, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/container-inspections/${id}/upload-photo?type=${type}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteContainerInspectionPhoto: (id, photoId) => axios.delete(`${API}/container-inspections/${id}/photo/${photoId}`),

  // Vistoria de Container
  getContainerVistorias: (params) => axios.get(`${API}/container-vistorias`, { params }),
  getVistoriasReport: (params) => axios.get(`${API}/reports/container-vistorias`, { params }),
  getVistoriasReportPdf: (params) => axios.get(`${API}/reports/container-vistorias/pdf`, { params, responseType: 'blob' }),
  getVistoriasReportExcel: (params) => axios.get(`${API}/reports/container-vistorias/excel`, { params, responseType: 'blob' }),
  getContainerVistoria: (id) => axios.get(`${API}/container-vistorias/${id}`),
  getContainerVistoriaByNumber: (number) => axios.get(`${API}/container-vistorias/by-number/${encodeURIComponent(number)}`),
  getContainerVistoriaPDF: (id) => axios.get(`${API}/container-vistorias/${id}/pdf`, { responseType: 'blob' }),
  createContainerVistoria: (data) => axios.post(`${API}/container-vistorias`, data),
  updateContainerVistoria: (id, data) => axios.put(`${API}/container-vistorias/${id}`, data),
  deleteContainerVistoria: (id) => axios.delete(`${API}/container-vistorias/${id}`),
  uploadContainerVistoriaPhoto: (id, type, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/container-vistorias/${id}/upload-photo?type=${type}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteContainerVistoriaPhoto: (id, photoId) => axios.delete(`${API}/container-vistorias/${id}/photo/${photoId}`),

  // Terminal - Orçamento de Reparo
  getRepairEstimates: (params) => axios.get(`${API}/repair-estimates`, { params }),
  getRepairEstimatesSummary: () => axios.get(`${API}/repair-estimates/summary`),
  getRepairEstimatesLastPrices: () => axios.get(`${API}/repair-estimates/last-prices`),
  createRepairEstimate: (data) => axios.post(`${API}/repair-estimates`, data),
  updateRepairEstimate: (id, data) => axios.put(`${API}/repair-estimates/${id}`, data),
  deleteRepairEstimate: (id) => axios.delete(`${API}/repair-estimates/${id}`),
  updateRepairEstimateStatus: (id, data) => axios.put(`${API}/repair-estimates/${id}/status`, data),
  getRepairEstimatePDF: (id) => axios.get(`${API}/repair-estimates/${id}/pdf`, { responseType: 'blob' }),

  // Auditoria de Estoque (Terminal)
  getContainerAudits: (params) => axios.get(`${API}/container-audits`, { params }),
  getContainerAudit: (id) => axios.get(`${API}/container-audits/${id}`),
  createContainerAudit: (data) => axios.post(`${API}/container-audits`, data),
  updateContainerAuditItem: (id, data) => axios.put(`${API}/container-audits/${id}/items`, data),
  uploadContainerAuditPhoto: (id, containerNumber, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/container-audits/${id}/items/${encodeURIComponent(containerNumber)}/photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteContainerAuditPhoto: (id, containerNumber) => axios.delete(`${API}/container-audits/${id}/items/${encodeURIComponent(containerNumber)}/photo`),
  deleteContainerAuditItem: (id, containerNumber) => axios.delete(`${API}/container-audits/${id}/items/${encodeURIComponent(containerNumber)}`),
  // Lê número e tamanho/tipo do container na foto (não grava nada)
  scanContainerAuditPhoto: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/container-audits/${id}/scan`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  completeContainerAudit: (id) => axios.post(`${API}/container-audits/${id}/complete`),
  deleteContainerAudit: (id) => axios.delete(`${API}/container-audits/${id}`),
  downloadContainerAuditPdf: (id) => axios.get(`${API}/container-audits/${id}/pdf`, { responseType: 'blob' }),

  // Comercial: Representante
  getRepresentatives: () => axios.get(`${API}/representatives`),
  createRepresentative: (data) => axios.post(`${API}/representatives`, data),
  updateRepresentative: (id, data) => axios.put(`${API}/representatives/${id}`, data),
  deleteRepresentative: (id) => axios.delete(`${API}/representatives/${id}`),

  // Comercial: Tabela de Serviços
  getServicePriceEntries: (params) => axios.get(`${API}/service-price-entries`, { params }),
  createServicePriceEntry: (data) => axios.post(`${API}/service-price-entries`, data),
  updateServicePriceEntry: (id, data) => axios.put(`${API}/service-price-entries/${id}`, data),
  deleteServicePriceEntry: (id) => axios.delete(`${API}/service-price-entries/${id}`),
  downloadServicePriceTablePdf: (clientId) => axios.get(`${API}/service-price-entries/pdf`, { params: { client_id: clientId }, responseType: 'blob' }),

  // Comercial: Vínculo de Clientes
  getClientRepresentativeLinks: () => axios.get(`${API}/client-representative-links`),
  createClientRepresentativeLink: (data) => axios.post(`${API}/client-representative-links`, data),
  updateClientRepresentativeLink: (id, data) => axios.put(`${API}/client-representative-links/${id}`, data),
  deleteClientRepresentativeLink: (id) => axios.delete(`${API}/client-representative-links/${id}`),
  getCommissionReport: (params) => axios.get(`${API}/reports/commission`, { params }),
  downloadCommissionReportPdf: (params) => axios.get(`${API}/reports/commission/pdf`, { params, responseType: 'blob' }),
  getCommissionEntries: (params) => axios.get(`${API}/commission-entries`, { params }),
  createCommissionEntry: (data) => axios.post(`${API}/commission-entries`, data),
  updateCommissionEntry: (id, data) => axios.put(`${API}/commission-entries/${id}`, data),
  deleteCommissionEntry: (id) => axios.delete(`${API}/commission-entries/${id}`),
  payCommissionEntries: (data) => axios.post(`${API}/commission-entries/pay`, data),
  unpayCommissionEntries: (ids) => axios.post(`${API}/commission-entries/unpay`, { ids }),
  getCommissionCteCandidates: (params) => axios.get(`${API}/commission-entries/cte-candidates`, { params }),
  createCommissionFromCtes: (ids) => axios.post(`${API}/commission-entries/from-ctes`, { ids }),
  downloadCommissionStatementPdf: (params) => axios.get(`${API}/commission-entries/pdf`, { params, responseType: 'blob' }),
  createCommissionBatch: (data) => axios.post(`${API}/commission-entries/batch`, data),
  getServiceProviderRoles: () => axios.get(`${API}/service-provider-roles`),
  getServiceProviders: () => axios.get(`${API}/service-providers`),
  createServiceProvider: (data) => axios.post(`${API}/service-providers`, data),
  updateServiceProvider: (id, data) => axios.put(`${API}/service-providers/${id}`, data),
  deleteServiceProvider: (id) => axios.delete(`${API}/service-providers/${id}`),
  getServiceProviderEntries: (params) => axios.get(`${API}/service-provider-entries`, { params }),
  createServiceProviderEntry: (data) => axios.post(`${API}/service-provider-entries`, data),
  updateServiceProviderEntry: (id, data) => axios.put(`${API}/service-provider-entries/${id}`, data),
  deleteServiceProviderEntry: (id) => axios.delete(`${API}/service-provider-entries/${id}`),
  getServiceProviderAdvances: (params) => axios.get(`${API}/service-provider-advances`, { params }),
  createServiceProviderAdvance: (data) => axios.post(`${API}/service-provider-advances`, data),
  updateServiceProviderAdvance: (id, data) => axios.put(`${API}/service-provider-advances/${id}`, data),
  deleteServiceProviderAdvance: (id) => axios.delete(`${API}/service-provider-advances/${id}`),
  getServiceProviderClosings: (params) => axios.get(`${API}/service-provider-closings`, { params }),
  getServiceProviderClosing: (id) => axios.get(`${API}/service-provider-closings/${id}`),
  createServiceProviderClosing: (data) => axios.post(`${API}/service-provider-closings`, data),
  cancelServiceProviderClosing: (id) => axios.delete(`${API}/service-provider-closings/${id}`),
  payServiceProviderClosing: (id, data) => axios.post(`${API}/service-provider-closings/${id}/pay`, data),
  unpayServiceProviderClosing: (id) => axios.post(`${API}/service-provider-closings/${id}/unpay`),
  downloadServiceProviderReceipt: (id) => axios.get(`${API}/service-provider-closings/${id}/receipt-pdf`, { responseType: 'blob' }),
  downloadServiceProviderReport: (params) => axios.get(`${API}/service-provider-closings/pdf`, { params, responseType: 'blob' }),
  downloadServiceProviderConference: (params, kind = 'pdf') => axios.get(`${API}/service-provider-report/${kind}`, { params, responseType: 'blob' }),
  getCommissionAdvances: (params) => axios.get(`${API}/commission-advances`, { params }),
  createCommissionAdvance: (data) => axios.post(`${API}/commission-advances`, data),
  updateCommissionAdvance: (id, data) => axios.put(`${API}/commission-advances/${id}`, data),
  deleteCommissionAdvance: (id) => axios.delete(`${API}/commission-advances/${id}`),

  // Comercial: Proposta Comercial
  getCommercialProposals: () => axios.get(`${API}/commercial-proposals`),
  getCommercialProposal: (id) => axios.get(`${API}/commercial-proposals/${id}`),
  createCommercialProposal: (data) => axios.post(`${API}/commercial-proposals`, data),
  updateCommercialProposal: (id, data) => axios.put(`${API}/commercial-proposals/${id}`, data),
  deleteCommercialProposal: (id) => axios.delete(`${API}/commercial-proposals/${id}`),
  updateCommercialProposalStatus: (id, status) => axios.put(`${API}/commercial-proposals/${id}/status`, null, { params: { status } }),
  downloadCommercialProposalPdf: (id) => axios.get(`${API}/commercial-proposals/${id}/pdf`, { responseType: 'blob' }),

  // Flex Tank (Controle de Estoque de Bolsas)
  getFlexTankMovements: (params) => axios.get(`${API}/flex-tank/movements`, { params }),
  getFlexTankMovement: (id) => axios.get(`${API}/flex-tank/movements/${id}`),
  createFlexTankMovement: (data) => axios.post(`${API}/flex-tank/movements`, data),
  updateFlexTankMovement: (id, data) => axios.put(`${API}/flex-tank/movements/${id}`, data),
  deleteFlexTankMovement: (id) => axios.delete(`${API}/flex-tank/movements/${id}`),
  getFlexTankStock: (params) => axios.get(`${API}/flex-tank/stock`, { params }),
  downloadFlexTankReport: (params) => axios.get(`${API}/flex-tank/report/excel`, { params, responseType: 'blob' }),
  
  // Fleet - Vehicle Revisions (Frota - Controle de Revisão)
  getVehicleRevisions: (params) => axios.get(`${API}/vehicle-revisions`, { params }),
  getRevisionsReport: (params) => axios.get(`${API}/reports/vehicle-revisions`, { params }),
  getRevisionsReportPdf: (params) => axios.get(`${API}/reports/vehicle-revisions/pdf`, { params, responseType: 'blob' }),
  getRevisionsReportExcel: (params) => axios.get(`${API}/reports/vehicle-revisions/excel`, { params, responseType: 'blob' }),
  getDeliveryReport: (params) => axios.get(`${API}/reports/delivery-status`, { params }),
  getDeliveryReportPdf: (params) => axios.get(`${API}/reports/delivery-status/pdf`, { params, responseType: 'blob' }),
  getDeliveryReportExcel: (params) => axios.get(`${API}/reports/delivery-status/excel`, { params, responseType: 'blob' }),
  getVehicleRevision: (id) => axios.get(`${API}/vehicle-revisions/${id}`),
  createVehicleRevision: (data) => axios.post(`${API}/vehicle-revisions`, data),
  updateVehicleRevision: (id, data) => axios.put(`${API}/vehicle-revisions/${id}`, data),
  deleteVehicleRevision: (id) => axios.delete(`${API}/vehicle-revisions/${id}`),
  getVehicleRevisionPDF: (id) => axios.get(`${API}/vehicle-revisions/${id}/pdf`, { responseType: 'blob' }),
  uploadVehicleRevisionKmPhoto: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/vehicle-revisions/${id}/upload-km-photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteVehicleRevisionKmPhoto: (id) => axios.delete(`${API}/vehicle-revisions/${id}/km-photo`),

  getOdometerReadings: (params) => axios.get(`${API}/odometer-readings`, { params }),
  createOdometerReading: (data) => axios.post(`${API}/odometer-readings`, data),
  updateOdometerReading: (id, data) => axios.put(`${API}/odometer-readings/${id}`, data),
  deleteOdometerReading: (id) => axios.delete(`${API}/odometer-readings/${id}`),
  getVehicleMaintenanceStatus: () => axios.get(`${API}/odometer-readings/maintenance-status`),

  getVehicleChecklistTemplate: () => axios.get(`${API}/vehicle-checklists/template`),
  getSimpleVehicleChecklistTemplate: (vehicleType) => axios.get(`${API}/vehicle-checklists/simple-template`, { params: { vehicle_type: vehicleType } }),
  getVehicleChecklists: (params) => axios.get(`${API}/vehicle-checklists`, { params }),
  getVehicleChecklistStats: (params) => axios.get(`${API}/vehicle-checklists/stats`, { params }),
  getVehicleChecklist: (id) => axios.get(`${API}/vehicle-checklists/${id}`),
  createVehicleChecklist: (data) => axios.post(`${API}/vehicle-checklists`, data),
  updateVehicleChecklist: (id, data) => axios.put(`${API}/vehicle-checklists/${id}`, data),
  deleteVehicleChecklist: (id) => axios.delete(`${API}/vehicle-checklists/${id}`),
  getVehicleChecklistPDF: (id) => axios.get(`${API}/vehicle-checklists/${id}/pdf`, { responseType: 'blob' }),
  uploadVehicleChecklistPhoto: (id, type, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/vehicle-checklists/${id}/upload-photo?type=${type}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteVehicleChecklistPhoto: (id, photoId) => axios.delete(`${API}/vehicle-checklists/${id}/photo/${photoId}`),
  getVehiclePlates: () => axios.get(`${API}/vehicles/plates`),
  
  // Fleet - Vehicles (Frota - Cadastro de Veículos)
  getVehicles: (params) => axios.get(`${API}/vehicles`, { params }),
  getVehicle: (id) => axios.get(`${API}/vehicles/${id}`),
  createVehicle: (data) => axios.post(`${API}/vehicles`, data),
  updateVehicle: (id, data) => axios.put(`${API}/vehicles/${id}`, data),
  deleteVehicle: (id) => axios.delete(`${API}/vehicles/${id}`),
  getVehicleTypes: () => axios.get(`${API}/vehicles/types/list`),
  
  // Operacional - Programação de Carregamento
  getLoadingSchedules: (params) => axios.get(`${API}/loading-schedules`, { params }),
  getLoadingSchedule: (id) => axios.get(`${API}/loading-schedules/${id}`),
  createLoadingSchedule: (data) => axios.post(`${API}/loading-schedules`, data),
  updateLoadingSchedule: (id, data) => axios.put(`${API}/loading-schedules/${id}`, data),
  deleteLoadingSchedule: (id) => axios.delete(`${API}/loading-schedules/${id}`),
  updateLoadingScheduleStatus: (id, status) => axios.put(`${API}/loading-schedules/${id}/update-status`, null, { params: { new_status: status } }),
  getLoadingSchedulePDF: (id) => axios.get(`${API}/loading-schedules/${id}/pdf`, { responseType: 'blob' }),

  // Financeiro - Solicitação de Diária
  getDailyRateRequests: (params) => axios.get(`${API}/daily-rate-requests`, { params }),
  getDailyRateRequest: (id) => axios.get(`${API}/daily-rate-requests/${id}`),
  createDailyRateRequest: (data) => axios.post(`${API}/daily-rate-requests`, data),
  updateDailyRateRequest: (id, data) => axios.put(`${API}/daily-rate-requests/${id}`, data),
  deleteDailyRateRequest: (id) => axios.delete(`${API}/daily-rate-requests/${id}`),
  updateDailyRateRequestStatus: (id, status) => axios.put(`${API}/daily-rate-requests/${id}/update-status?new_status=${status}`),
  // Marca como pagos (ou não) os itens/motoristas da solicitação, pela posição
  setDailyRatePaidItems: (id, indexes, paid) => axios.put(`${API}/daily-rate-requests/${id}/paid-items`, { indexes, paid }),
  getDailyRateRequestPDF: (id) => axios.get(`${API}/daily-rate-requests/${id}/pdf`, { responseType: 'blob' }),

  // Financeiro - Controle de Cheque
  getChecks: (params) => axios.get(`${API}/checks`, { params }),
  getChecksSummary: () => axios.get(`${API}/checks/summary`),
  createCheck: (data) => axios.post(`${API}/checks`, data),
  updateCheck: (id, data) => axios.put(`${API}/checks/${id}`, data),
  deleteCheck: (id) => axios.delete(`${API}/checks/${id}`),
  updateCheckStatus: (id, data) => axios.put(`${API}/checks/${id}/status`, data),
  uploadCheckPhoto: (id, side, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/checks/${id}/photo`, formData, {
      params: { side },
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteCheckPhoto: (id, side) => axios.delete(`${API}/checks/${id}/photo/${side}`),
  getChecksReportPDF: (params) => axios.get(`${API}/checks/report/pdf`, { params, responseType: 'blob' }),

  // Financeiro - Controle de Gratificação
  getGratificationRoles: () => axios.get(`${API}/gratification-roles`),
  createGratificationRole: (data) => axios.post(`${API}/gratification-roles`, data),
  deleteGratificationRole: (id) => axios.delete(`${API}/gratification-roles/${id}`),
  getGratifications: (params) => axios.get(`${API}/gratifications`, { params }),
  createGratification: (data) => axios.post(`${API}/gratifications`, data),
  updateGratification: (id, data) => axios.put(`${API}/gratifications/${id}`, data),
  deleteGratification: (id) => axios.delete(`${API}/gratifications/${id}`),
  payGratifications: (data) => axios.post(`${API}/gratifications/pay`, data),
  updateGratificationStatus: (id, status) => axios.put(`${API}/gratifications/${id}/status`, null, { params: { status } }),
  getGratificationReceiptPDF: (ids) => axios.get(`${API}/gratifications/receipt/pdf`, { params: { ids: ids.join(',') }, responseType: 'blob' }),
  getGratificationsReport: (params) => axios.get(`${API}/reports/gratifications`, { params }),
  downloadGratificationsReportPdf: (params) => axios.get(`${API}/reports/gratifications/pdf`, { params, responseType: 'blob' }),
  downloadGratificationsReportExcel: (params) => axios.get(`${API}/reports/gratifications/excel`, { params, responseType: 'blob' }),

  // RH
  uploadHRFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/hr/uploads`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getHRMeta: () => axios.get(`${API}/hr/meta`),
  getHRDashboard: () => axios.get(`${API}/hr/dashboard`),
  getHRPositions: (params) => axios.get(`${API}/hr/positions`, { params }),
  createHRPosition: (data) => axios.post(`${API}/hr/positions`, data),
  updateHRPosition: (id, data) => axios.put(`${API}/hr/positions/${id}`, data),
  deleteHRPosition: (id) => axios.delete(`${API}/hr/positions/${id}`),
  getHRContracts: (params) => axios.get(`${API}/hr/contracts`, { params }),
  getHRContract: (id) => axios.get(`${API}/hr/contracts/${id}`),
  createHRContract: (data) => axios.post(`${API}/hr/contracts`, data),
  updateHRContract: (id, data) => axios.put(`${API}/hr/contracts/${id}`, data),
  deleteHRContract: (id) => axios.delete(`${API}/hr/contracts/${id}`),
  updateHRContractStatus: (id, status) => axios.put(`${API}/hr/contracts/${id}/status`, null, { params: { status } }),
  terminateHRContract: (id, data) => axios.post(`${API}/hr/contracts/${id}/terminate`, data),
  reinstateHRContract: (id) => axios.post(`${API}/hr/contracts/${id}/reinstate`),
  extendHRExperience: (id, data) => axios.post(`${API}/hr/contracts/${id}/extend-experience`, data),
  setHRSalaryAdvance: (data) => axios.put(`${API}/hr/contracts-salary-advance`, data),
  getHRTerminationPDF: (id) => axios.get(`${API}/hr/contracts/${id}/termination/pdf`, { responseType: 'blob' }),
  getHRContractSheetPDF: (id) => axios.get(`${API}/hr/contracts/${id}/sheet/pdf`, { responseType: 'blob' }),
  getHRWorkContractPDF: (id) => axios.get(`${API}/hr/contracts/${id}/contract/pdf`, { responseType: 'blob' }),
  getPayrollSettings: () => axios.get(`${API}/hr/payroll-settings`),
  updatePayrollSettings: (data) => axios.put(`${API}/hr/payroll-settings`, data),
  resetPayrollSettings: () => axios.post(`${API}/hr/payroll-settings/reset`),
  getPayrollRuns: (params) => axios.get(`${API}/hr/payroll-runs`, { params }),
  getPayrollRun: (id) => axios.get(`${API}/hr/payroll-runs/${id}`),
  createPayrollRun: (data) => axios.post(`${API}/hr/payroll-runs`, data),
  deletePayrollRun: (id) => axios.delete(`${API}/hr/payroll-runs/${id}`),
  recalculatePayrollRun: (id) => axios.post(`${API}/hr/payroll-runs/${id}/recalculate`),
  closePayrollRun: (id) => axios.post(`${API}/hr/payroll-runs/${id}/close`),
  reopenPayrollRun: (id) => axios.post(`${API}/hr/payroll-runs/${id}/reopen`),
  payPayrollRun: (id, data) => axios.post(`${API}/hr/payroll-runs/${id}/pay`, data),
  unpayPayrollRun: (id) => axios.post(`${API}/hr/payroll-runs/${id}/unpay`),
  updatePayslip: (id, data) => axios.put(`${API}/hr/payslips/${id}`, data),
  getPayslipsPDF: (params) => axios.get(`${API}/hr/payslips/pdf`, { params, responseType: 'blob' }),
  getPayrollCheck: (id) => axios.get(`${API}/hr/payroll-runs/${id}/check`),
  getPayrollCheckPDF: (id) => axios.get(`${API}/hr/payroll-runs/${id}/check/pdf`, { responseType: 'blob' }),
  getPayrollCheckExcel: (id) => axios.get(`${API}/hr/payroll-runs/${id}/check/excel`, { responseType: 'blob' }),
  getVacationBalances: () => axios.get(`${API}/hr/vacation-balances`),
  getVacations: (params) => axios.get(`${API}/hr/vacations`, { params }),
  previewVacation: (data, vacationId) => axios.post(`${API}/hr/vacations/preview`, data, { params: vacationId ? { vacation_id: vacationId } : {} }),
  createVacation: (data) => axios.post(`${API}/hr/vacations`, data),
  updateVacation: (id, data) => axios.put(`${API}/hr/vacations/${id}`, data),
  deleteVacation: (id) => axios.delete(`${API}/hr/vacations/${id}`),
  payVacation: (id, data) => axios.post(`${API}/hr/vacations/${id}/pay`, data),
  updateVacationStatus: (id, status) => axios.put(`${API}/hr/vacations/${id}/status`, null, { params: { status } }),
  getVacationReceiptPDF: (id) => axios.get(`${API}/hr/vacations/${id}/receipt/pdf`, { responseType: 'blob' }),
  getVacationNoticePDF: (id) => axios.get(`${API}/hr/vacations/${id}/notice/pdf`, { responseType: 'blob' }),
  getHROccurrences: (params) => axios.get(`${API}/hr/occurrences`, { params }),
  createHROccurrence: (data) => axios.post(`${API}/hr/occurrences`, data),
  updateHROccurrence: (id, data) => axios.put(`${API}/hr/occurrences/${id}`, data),
  deleteHROccurrence: (id) => axios.delete(`${API}/hr/occurrences/${id}`),
  getHROccurrencePDF: (id) => axios.get(`${API}/hr/occurrences/${id}/pdf`, { responseType: 'blob' }),
  getTimeBank: (params) => axios.get(`${API}/hr/time-bank`, { params }),
  getTimeBankBalances: () => axios.get(`${API}/hr/time-bank/balances`),
  createTimeBank: (data) => axios.post(`${API}/hr/time-bank`, data),
  deleteTimeBank: (id) => axios.delete(`${API}/hr/time-bank/${id}`),
  getHRDocuments: (params) => axios.get(`${API}/hr/documents`, { params }),
  createHRDocument: (data) => axios.post(`${API}/hr/documents`, data),
  updateHRDocument: (id, data) => axios.put(`${API}/hr/documents/${id}`, data),
  deleteHRDocument: (id) => axios.delete(`${API}/hr/documents/${id}`),
  getHRReport: (kind, params) => axios.get(`${API}/reports/hr/${kind}`, { params }),
  downloadHRReportPdf: (kind, params) => axios.get(`${API}/reports/hr/${kind}/pdf`, { params, responseType: 'blob' }),
  downloadHRReportExcel: (kind, params) => axios.get(`${API}/reports/hr/${kind}/excel`, { params, responseType: 'blob' }),

  // Financeiro - Relatórios do período (conferência)
  getDailyRatesReport: (params) => axios.get(`${API}/reports/daily-rates`, { params }),
  downloadDailyRatesReportPdf: (params) => axios.get(`${API}/reports/daily-rates/pdf`, { params, responseType: 'blob' }),
  downloadDailyRatesReportExcel: (params) => axios.get(`${API}/reports/daily-rates/excel`, { params, responseType: 'blob' }),
  getExpensesReport: (params) => axios.get(`${API}/reports/expenses`, { params }),
  getExpenseDashboard: (params) => axios.get(`${API}/expense-reports/dashboard`, { params }),
  getExpenseGroups: () => axios.get(`${API}/expense-groups`),
  createExpenseGroup: (data) => axios.post(`${API}/expense-groups`, data),
  updateExpenseGroup: (id, data) => axios.put(`${API}/expense-groups/${id}`, data),
  deleteExpenseGroup: (id) => axios.delete(`${API}/expense-groups/${id}`),
  downloadExpensesReportPdf: (params) => axios.get(`${API}/reports/expenses/pdf`, { params, responseType: 'blob' }),
  downloadExpensesReportExcel: (params) => axios.get(`${API}/reports/expenses/excel`, { params, responseType: 'blob' }),
  getExpenseSettlementsReport: (params) => axios.get(`${API}/reports/expenses/settlements`, { params }),
  downloadExpenseSettlementsReportPdf: (params) => axios.get(`${API}/reports/expenses/settlements/pdf`, { params, responseType: 'blob' }),
  downloadExpenseSettlementsReportExcel: (params) => axios.get(`${API}/reports/expenses/settlements/excel`, { params, responseType: 'blob' }),

  // Gestão de Container - relatório de compra e venda
  getFreightReconciliation: (params) => axios.get(`${API}/reports/freight-reconciliation`, { params }),
  downloadFreightReconciliationPdf: (params) => axios.get(`${API}/reports/freight-reconciliation/pdf`, { params, responseType: 'blob' }),
  downloadFreightReconciliationExcel: (params) => axios.get(`${API}/reports/freight-reconciliation/excel`, { params, responseType: 'blob' }),
  getContainersReport: (params) => axios.get(`${API}/reports/containers`, { params }),
  downloadContainersReportPdf: (params) => axios.get(`${API}/reports/containers/pdf`, { params, responseType: 'blob' }),
  downloadContainersReportExcel: (params) => axios.get(`${API}/reports/containers/excel`, { params, responseType: 'blob' }),

  // Financeiro - Prestação de Contas
  getExpenseReports: (params) => axios.get(`${API}/expense-reports`, { params }),
  getExpenseReport: (id) => axios.get(`${API}/expense-reports/${id}`),
  createExpenseReport: (data) => axios.post(`${API}/expense-reports`, data),
  updateExpenseReport: (id, data) => axios.put(`${API}/expense-reports/${id}`, data),
  deleteExpenseReport: (id) => axios.delete(`${API}/expense-reports/${id}`),
  updateExpenseReportStatus: (id, status) => axios.put(`${API}/expense-reports/${id}/status?status=${status}`),
  // Acerto do saldo (ressarcimento pago / devolução recebida); date 'YYYY-MM-DD'
  setExpenseReportSettlement: (id, settled, date) => axios.put(`${API}/expense-reports/${id}/settlement`, { settled, date }),
  uploadExpenseReportReceipt: (reportId, itemId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/expense-reports/${reportId}/purchases/${itemId}/upload-receipt`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteExpenseReportReceipt: (reportId, itemId, receiptId) =>
    axios.delete(`${API}/expense-reports/${reportId}/purchases/${itemId}/receipt/${receiptId}`),
  getExpenseReportPDF: (id) => axios.get(`${API}/expense-reports/${id}/pdf`, { responseType: 'blob' }),

  // Operacional - Status de Entrega
  getDeliveryStatuses: (params) => axios.get(`${API}/delivery-status`, { params }),
  getDeliveryStatus: (id) => axios.get(`${API}/delivery-status/${id}`),
  getScheduleForDeliveryStatus: (scheduleNumber) => axios.get(`${API}/delivery-status/schedule/${scheduleNumber}`),
  createDeliveryStatus: (data) => axios.post(`${API}/delivery-status`, data),
  updateDeliveryStatus: (id, data) => axios.put(`${API}/delivery-status/${id}`, data),
  deleteDeliveryStatus: (id) => axios.delete(`${API}/delivery-status/${id}`),
  updateDeliveryStatusStatus: (id, status) => axios.put(`${API}/delivery-status/${id}/update-status?new_status=${status}`),
  getDeliveryStatusPDF: (id) => axios.get(`${API}/delivery-status/${id}/pdf`, { responseType: 'blob' }),
  getDeliveryStatusExcel: (id) => axios.get(`${API}/delivery-status/${id}/excel`, { responseType: 'blob' }),

  // Operacional - Serviço Portuário
  getPortServices: (params) => axios.get(`${API}/port-services`, { params }),
  getPortService: (id) => axios.get(`${API}/port-services/${id}`),
  createPortService: (data) => axios.post(`${API}/port-services`, data),
  updatePortService: (id, data) => axios.put(`${API}/port-services/${id}`, data),
  deletePortService: (id) => axios.delete(`${API}/port-services/${id}`),
  getPortServicePDF: (id) => axios.get(`${API}/port-services/${id}/pdf`, { responseType: 'blob' }),
  getPortServicesReportSummary: (params) => axios.get(`${API}/reports/port-services/summary`, { params }),
  getPortServicesDailyChart: () => axios.get(`${API}/reports/port-services/daily-chart`),
  downloadPortServicesPDFReport: (params) => axios.get(`${API}/reports/port-services/pdf`, { params, responseType: 'blob' }),
  downloadPortServicesExcelReport: (params) => axios.get(`${API}/reports/port-services/excel`, { params, responseType: 'blob' }),
  getVehicleResults: (params) => axios.get(`${API}/reports/vehicle-results/summary`, { params }),
  downloadVehicleResultsPDF: (params) => axios.get(`${API}/reports/vehicle-results/pdf`, { params, responseType: 'blob' }),
  downloadVehicleResultsExcel: (params) => axios.get(`${API}/reports/vehicle-results/excel`, { params, responseType: 'blob' }),
  // Conferência de Turnos (horários dos Serviços Portuários x turno previsto)
  getPortServiceShifts: (params) => axios.get(`${API}/reports/port-service-shifts`, { params }),
  downloadPortServiceShiftsPDF: (params) => axios.get(`${API}/reports/port-service-shifts/pdf`, { params, responseType: 'blob' }),
  downloadPortServiceShiftsExcel: (params) => axios.get(`${API}/reports/port-service-shifts/excel`, { params, responseType: 'blob' }),

  // Financeiro - Faturamento de Serviço Portuário
  getPortServiceBillingCandidates: (params) => axios.get(`${API}/port-services/billing-candidates`, { params }),
  createPortServiceBillingBatch: (data) => axios.post(`${API}/port-services/billing-batches`, data),
  getPortServiceBillingBatches: (params) => axios.get(`${API}/port-services/billing-batches`, { params }),
  getPortServiceBillingBatch: (id) => axios.get(`${API}/port-services/billing-batches/${id}`),
  updatePortServiceBillingBatch: (id, data) => axios.put(`${API}/port-services/billing-batches/${id}`, data),
  getPortServiceBillingBatchServices: (id) => axios.get(`${API}/port-services/billing-batches/${id}/services`),
  updatePortServiceBillingBatchStatus: (id, status) => axios.put(`${API}/port-services/billing-batches/${id}/status?status=${status}`),
  getPortServiceBillingBatchPDF: (id) => axios.get(`${API}/port-services/billing-batches/${id}/pdf`, { responseType: 'blob' }),
  getPortServiceBillingBatchExcel: (id) => axios.get(`${API}/port-services/billing-batches/${id}/excel`, { responseType: 'blob' }),

  // Unit Segregation
  getUnitSegregations: (params) => axios.get(`${API}/unit-segregations`, { params }),
  getUnitSegregation: (id) => axios.get(`${API}/unit-segregations/${id}`),
  createUnitSegregation: (data) => axios.post(`${API}/unit-segregations`, data),
  updateUnitSegregation: (id, data) => axios.put(`${API}/unit-segregations/${id}`, data),
  deleteUnitSegregation: (id) => axios.delete(`${API}/unit-segregations/${id}`),
  releaseUnitSegregation: (id) => axios.post(`${API}/unit-segregations/${id}/release`),
  getUnitSegregationPDF: (id) => axios.get(`${API}/unit-segregations/${id}/pdf`, { responseType: 'blob' }),
  getUnitSegregationLabel: (id) => axios.get(`${API}/unit-segregations/${id}/label`, { responseType: 'blob' }),
  checkContainerSegregation: (containerNumber) => axios.get(`${API}/check-segregation/${containerNumber}`),
  checkContainerSegregationBatch: (containerNumbers) => axios.post(`${API}/check-segregation-batch`, { container_numbers: containerNumbers }),

  // RPA Terceiro / Agregado
  getRPATerceiros: (params) => axios.get(`${API}/rpa-terceiro`, { params }),
  getRPATerceiro: (id) => axios.get(`${API}/rpa-terceiro/${id}`),
  getRPATerceiroNextNumber: (rpaType = 'terceiro') => axios.get(`${API}/rpa-terceiro/next-number`, { params: { rpa_type: rpaType } }),
  getRPADriverInfo: (driverId) => axios.get(`${API}/rpa-terceiro/driver-info/${driverId}`),
  createRPATerceiro: (data) => axios.post(`${API}/rpa-terceiro`, data),
  updateRPATerceiro: (id, data) => axios.put(`${API}/rpa-terceiro/${id}`, data),
  deleteRPATerceiro: (id) => axios.delete(`${API}/rpa-terceiro/${id}`),
  getRPATerceiroPDF: (id) => axios.get(`${API}/rpa-terceiro/${id}/pdf`, { responseType: 'blob' }),

  // Ordem de Serviço (Frota)
  getOrdensServico: (params) => axios.get(`${API}/ordem-servico`, { params }),
  getOrdemServico: (id) => axios.get(`${API}/ordem-servico/${id}`),
  getOrdemServicoNextNumber: () => axios.get(`${API}/ordem-servico/next-number`),
  createOrdemServico: (data) => axios.post(`${API}/ordem-servico`, data),
  updateOrdemServico: (id, data) => axios.put(`${API}/ordem-servico/${id}`, data),
  deleteOrdemServico: (id) => axios.delete(`${API}/ordem-servico/${id}`),
  getOrdemServicoPDF: (id) => axios.get(`${API}/ordem-servico/${id}/pdf`, { responseType: 'blob' }),

  // Controle de Abastecimento (Frota)
  getFuelSupplies: (params) => axios.get(`${API}/fuel-supplies`, { params }),
  getFuelSupply: (id) => axios.get(`${API}/fuel-supplies/${id}`),
  getFuelSupplyNextNumber: () => axios.get(`${API}/fuel-supplies/next-number`),
  createFuelSupply: (data) => axios.post(`${API}/fuel-supplies`, data),
  updateFuelSupply: (id, data) => axios.put(`${API}/fuel-supplies/${id}`, data),
  deleteFuelSupply: (id) => axios.delete(`${API}/fuel-supplies/${id}`),
  uploadFuelSupplyReceipt: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/fuel-supplies/${id}/receipt`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteFuelSupplyReceipt: (id) => axios.delete(`${API}/fuel-supplies/${id}/receipt`),
  getFuelConsumptionSummary: () => axios.get(`${API}/fuel-supplies/consumption-summary`),
  getFuelConsumptionHistory: (params) => axios.get(`${API}/fuel-supplies/consumption-history`, { params }),
  getTankSettings: () => axios.get(`${API}/tank-settings`),
  updateTankSettings: (data) => axios.put(`${API}/tank-settings`, data),
  getTankLevel: () => axios.get(`${API}/tank-level`),
  getTankLedger: () => axios.get(`${API}/tank-ledger`),
  createTankRefill: (data) => axios.post(`${API}/tank-refills`, data),
  deleteTankRefill: (id) => axios.delete(`${API}/tank-refills/${id}`),
  getTankRefillNfeOptions: () => axios.get(`${API}/tank-refills/nfe-options`),

  // Ordem de Abastecimento (Frota)
  getFuelSupplyOrders: (params) => axios.get(`${API}/fuel-supply-orders`, { params }),
  getFuelSupplyOrder: (id) => axios.get(`${API}/fuel-supply-orders/${id}`),
  getFuelSupplyOrderNextNumber: () => axios.get(`${API}/fuel-supply-orders/next-number`),
  createFuelSupplyOrder: (data) => axios.post(`${API}/fuel-supply-orders`, data),
  updateFuelSupplyOrder: (id, data) => axios.put(`${API}/fuel-supply-orders/${id}`, data),
  deleteFuelSupplyOrder: (id) => axios.delete(`${API}/fuel-supply-orders/${id}`),
  getFuelSupplyOrderPDF: (id) => axios.get(`${API}/fuel-supply-orders/${id}/pdf`, { responseType: 'blob' }),
  getFuelSupplyOrdersPDF: (ids) => axios.get(`${API}/fuel-supply-orders/pdf`, { params: { ids: ids.join(',') }, responseType: 'blob' }),

  // Relatório de Abastecimento (Frota)
  getFuelSupplyReportSummary: (params) => axios.get(`${API}/reports/fuel-supply/summary`, { params }),
  getFuelSupplyDailyChart: () => axios.get(`${API}/reports/fuel-supply/daily-chart`),
  downloadFuelSupplyPDFReport: (params) => axios.get(`${API}/reports/fuel-supply/pdf`, { params, responseType: 'blob' }),
  downloadFuelSupplyExcelReport: (params) => axios.get(`${API}/reports/fuel-supply/excel`, { params, responseType: 'blob' }),

  // Relatório de Serviços (Frota)
  getServiceOrdersReportSummary: (params) => axios.get(`${API}/reports/service-orders/summary`, { params }),
  getServiceOrdersDailyChart: () => axios.get(`${API}/reports/service-orders/daily-chart`),
  downloadServiceOrdersPDFReport: (params) => axios.get(`${API}/reports/service-orders/pdf`, { params, responseType: 'blob' }),
  downloadServiceOrdersExcelReport: (params) => axios.get(`${API}/reports/service-orders/excel`, { params, responseType: 'blob' }),

  // Ordem de Carregamento (Transporte)
  getLoadingOrders: (params) => axios.get(`${API}/loading-orders`, { params }),
  getLoadingOrder: (id) => axios.get(`${API}/loading-orders/${id}`),
  getLoadingOrderNextNumber: () => axios.get(`${API}/loading-orders/next-number`),
  getNextAutoBookingNumber: () => axios.get(`${API}/loading-orders/next-booking-number`),
  createLoadingOrder: (data) => axios.post(`${API}/loading-orders`, data),
  updateLoadingOrder: (id, data) => axios.put(`${API}/loading-orders/${id}`, data),
  deleteLoadingOrder: (id) => axios.delete(`${API}/loading-orders/${id}`),
  getLoadingOrderPDF: (id) => axios.get(`${API}/loading-orders/${id}/pdf`, { responseType: 'blob' }),

  // Fiscal (CT-e pela Focus NFe)
  getFiscalSettings: () => axios.get(`${API}/fiscal/settings`),
  updateFiscalSettings: (data) => axios.put(`${API}/fiscal/settings`, data),
  syncFiscalCompany: () => axios.post(`${API}/fiscal/settings/sync`),
  uploadFiscalCertificate: (file, password) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);
    return axios.post(`${API}/fiscal/settings/certificate`, formData);
  },
  getCtes: (params) => axios.get(`${API}/ctes`, { params }),
  getCte: (id) => axios.get(`${API}/ctes/${id}`),
  getCteDraftFromLoadingOrder: (orderId) => axios.get(`${API}/ctes/from-loading-order/${orderId}`),
  createCte: (data) => axios.post(`${API}/ctes`, data),
  updateCte: (id, data) => axios.put(`${API}/ctes/${id}`, data),
  deleteCte: (id) => axios.delete(`${API}/ctes/${id}`),
  emitCte: (id) => axios.post(`${API}/ctes/${id}/emitir`),
  refreshCte: (id) => axios.post(`${API}/ctes/${id}/atualizar`),
  cancelCte: (id, justificativa) => axios.post(`${API}/ctes/${id}/cancelar`, { justificativa }),
  getCtePDF: (id) => axios.get(`${API}/ctes/${id}/pdf`, { responseType: 'blob' }),
  getCteXML: (id) => axios.get(`${API}/ctes/${id}/xml`, { responseType: 'blob' }),
  getCtePreviewPDF: (id) => axios.get(`${API}/ctes/${id}/preview-pdf`, { responseType: 'blob' }),
  getMdfes: (params) => axios.get(`${API}/mdfes`, { params }),
  getMdfeDraftFromCtes: (ids) => axios.get(`${API}/mdfes/from-ctes`, { params: { ids: ids.join(',') } }),
  createMdfe: (data) => axios.post(`${API}/mdfes`, data),
  updateMdfe: (id, data) => axios.put(`${API}/mdfes/${id}`, data),
  deleteMdfe: (id) => axios.delete(`${API}/mdfes/${id}`),
  emitMdfe: (id) => axios.post(`${API}/mdfes/${id}/emitir`),
  refreshMdfe: (id) => axios.post(`${API}/mdfes/${id}/atualizar`),
  closeMdfe: (id, data) => axios.post(`${API}/mdfes/${id}/encerrar`, data),
  addMdfeDriver: (id, data) => axios.post(`${API}/mdfes/${id}/incluir-condutor`, data),
  cancelMdfe: (id, justificativa) => axios.post(`${API}/mdfes/${id}/cancelar`, { justificativa }),
  getMdfePDF: (id) => axios.get(`${API}/mdfes/${id}/pdf`, { responseType: 'blob' }),
  getMdfeXML: (id) => axios.get(`${API}/mdfes/${id}/xml`, { responseType: 'blob' }),

  // Rota (Transporte)
  getFreightRoutes: () => axios.get(`${API}/freight-routes`),
  createFreightRoute: (data) => axios.post(`${API}/freight-routes`, data),
  updateFreightRoute: (id, data) => axios.put(`${API}/freight-routes/${id}`, data),
  deleteFreightRoute: (id) => axios.delete(`${API}/freight-routes/${id}`),

  // Pagamento Frete (Transporte)
  getFreightPayments: (params) => axios.get(`${API}/freight-payments`, { params }),
  getFreightPayment: (id) => axios.get(`${API}/freight-payments/${id}`),
  updateFreightPayment: (id, data) => axios.put(`${API}/freight-payments/${id}`, data),
  updateFreightPaymentStatus: (id, status) => axios.put(`${API}/freight-payments/${id}/status?status=${status}`),
  getFreightPaymentReportPDF: (params) => axios.get(`${API}/freight-payments/report/pdf`, { params, responseType: 'blob' }),
  getFreightPaymentReportExcel: (params) => axios.get(`${API}/freight-payments/report/excel`, { params, responseType: 'blob' }),
  markFreightPaymentsPaidBatch: (paymentIds) => axios.post(`${API}/freight-payments/mark-paid-batch`, { payment_ids: paymentIds }),
  getFreightPaymentBatches: (params) => axios.get(`${API}/freight-payments/batches`, { params }),
  getFreightPaymentBatchReceiptPDF: (batchId) => axios.get(`${API}/freight-payments/batches/${batchId}/receipt/pdf`, { responseType: 'blob' }),

  // Cadastro de Representantes (Gestão de Container)
  getContainerRepresentatives: () => axios.get(`${API}/container-representatives`),
  createContainerRepresentative: (data) => axios.post(`${API}/container-representatives`, data),
  updateContainerRepresentative: (id, data) => axios.put(`${API}/container-representatives/${id}`, data),
  deleteContainerRepresentative: (id) => axios.delete(`${API}/container-representatives/${id}`),

  // Compra de Container (Gestão de Container)
  getContainerPurchases: (params) => axios.get(`${API}/container-purchases`, { params }),
  getContainerPurchase: (id) => axios.get(`${API}/container-purchases/${id}`),
  createContainerPurchase: (data) => axios.post(`${API}/container-purchases`, data),
  updateContainerPurchase: (id, data) => axios.put(`${API}/container-purchases/${id}`, data),
  deleteContainerPurchase: (id) => axios.delete(`${API}/container-purchases/${id}`),

  // Registro de Venda (Gestão de Container)
  getContainerSales: (params) => axios.get(`${API}/container-sales`, { params }),
  getContainerSale: (id) => axios.get(`${API}/container-sales/${id}`),
  createContainerSale: (data) => axios.post(`${API}/container-sales`, data),
  updateContainerSale: (id, data) => axios.put(`${API}/container-sales/${id}`, data),
  updateContainerSaleStatus: (id, status) => axios.put(`${API}/container-sales/${id}/status?status=${status}`),
  deleteContainerSale: (id) => axios.delete(`${API}/container-sales/${id}`),
};

export default api;