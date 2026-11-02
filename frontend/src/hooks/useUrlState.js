import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// useState que também fica na URL (?status=CHEIO&dateFrom=2026-10-01): ao
// abrir um registro e voltar, ou ao recarregar, os filtros continuam lá, e o
// endereço filtrado pode ser enviado para outra pessoa. A URL é trocada com
// `replace`, sem criar entrada nova no histórico a cada letra digitada.
//
// Só valores simples vão para a URL (texto, número, sim/não, uma lista de
// textos como o período ['2026-10-01', '2026-10-31'], ou um objeto raso
// desses, como `filters`). O valor igual ao inicial sai da URL. Um valor
// que não cabe na URL (ex.: um item escolhido num Autocomplete) fica só na
// tela, como num useState comum.

// Vários set no mesmo clique (ex.: "Limpar filtros") viram uma troca só de URL
let pending = null;
function writeUrl(navigate, mutate) {
  if (!pending) {
    pending = new URLSearchParams(window.location.search);
    queueMicrotask(() => {
      const search = pending.toString();
      pending = null;
      if (`?${search}` === window.location.search || (!search && !window.location.search)) return;
      navigate(
        { pathname: window.location.pathname, search: search ? `?${search}` : '', hash: window.location.hash },
        { replace: true, preventScrollReset: true },
      );
    });
  }
  mutate(pending);
}

const isSimple = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const isTextList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isFlatObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isSimple);

// Converte o texto da URL no tipo do valor inicial
function parse(raw, initial) {
  if (raw === null) return initial;
  if (isTextList(initial)) {
    const parts = raw.split(',');
    return initial.map((fallback, i) => parts[i] ?? fallback);
  }
  if (typeof initial === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : initial;
  }
  if (typeof initial === 'boolean') return raw === 'true';
  return raw;
}

function readFromUrl(search, key, initial) {
  const params = new URLSearchParams(search);
  if (isFlatObject(initial)) {
    const next = { ...initial };
    Object.keys(initial).forEach((field) => { next[field] = parse(params.get(field), initial[field]); });
    return next;
  }
  if (!isSimple(initial) && !isTextList(initial)) return initial;
  return parse(params.get(key), initial);
}

function writeValue(params, key, value, initial) {
  const put = (k, v, init) => {
    if (isTextList(init)) {
      if (!isTextList(v) || v.every((x, i) => x === init[i])) params.delete(k);
      else params.set(k, v.join(','));
      return;
    }
    if (v === init || v === null || v === undefined || v === '' || !isSimple(v)) params.delete(k);
    else params.set(k, String(v));
  };
  if (isFlatObject(initial)) {
    Object.keys(initial).forEach((field) => put(field, value?.[field], initial[field]));
  } else {
    put(key, value, initial);
  }
}

export function useUrlState(key, initialValue) {
  const navigate = useNavigate();
  const location = useLocation();
  const initialRef = useRef(initialValue);
  const initial = initialRef.current;
  const supported = isSimple(initial) || isTextList(initial) || isFlatObject(initial);

  const [value, setValue] = useState(() => (supported ? readFromUrl(location.search, key, initial) : initial));
  const valueRef = useRef(value);
  valueRef.current = value;

  const set = useCallback((next) => {
    const resolved = typeof next === 'function' ? next(valueRef.current) : next;
    valueRef.current = resolved;
    setValue(resolved);
    if (supported) writeUrl(navigate, (params) => writeValue(params, key, resolved, initial));
  }, [navigate, key, initial, supported]);

  // A URL mudou por fora (link com filtro, voltar do navegador): segue a URL
  useEffect(() => {
    if (!supported) return;
    const fromUrl = readFromUrl(location.search, key, initial);
    const current = valueRef.current;
    const same = isFlatObject(initial)
      ? Object.keys(initial).every((f) => fromUrl[f] === current?.[f] || (!isSimple(current?.[f]) && fromUrl[f] === initial[f]))
      : isTextList(initial)
        ? isTextList(current) && fromUrl.every((x, i) => x === current[i])
        : fromUrl === current || (!isSimple(current) && fromUrl === initial);
    if (!same) {
      valueRef.current = fromUrl;
      setValue(fromUrl);
    }
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  return [value, set];
}

export default useUrlState;
