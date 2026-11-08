import { useLocation, useNavigate, useParams } from 'react-router-dom';

// Telas cuja lista e formulário moram no mesmo componente: `${base}` é a
// lista, `${base}/new` o cadastro e `${base}/:id/edit` a edição. Ir pro
// formulário guarda os filtros da lista (?status=...) e voltar os devolve.
export function useFormRoute(base) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mode = location.pathname === `${base}/new`
    ? 'new'
    : (id && location.pathname === `${base}/${id}/edit` ? 'edit' : 'list');
  const listSearch = location.state?.listSearch ?? '';

  return {
    mode,
    id: mode === 'edit' ? id : null,
    isForm: mode !== 'list',
    goNew: (state) => navigate(`${base}/new`, { state: { listSearch: location.search, ...state } }),
    goEdit: (recordId, state) => navigate(`${base}/${recordId}/edit`, { state: { listSearch: location.search, ...state } }),
    backToList: () => navigate(`${base}${listSearch}`),
    state: location.state || {},
  };
}
