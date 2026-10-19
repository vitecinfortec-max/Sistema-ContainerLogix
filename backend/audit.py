"""Log de auditoria geral: quem criou, alterou ou excluiu o quê, e quando.

Em vez de cada rota registrar o que fez (fácil de esquecer numa rota nova),
o próprio acesso ao banco registra: `shared.db` é um AuditedDatabase, que
repassa tudo ao banco real e, nas gravações feitas dentro de uma requisição
de usuário logado, grava em `audit_log`:
  - criação: o registro criado;
  - alteração: campo a campo, o valor de antes e o de depois;
  - exclusão: uma cópia completa do que foi apagado.

O usuário vem de `set_actor`, chamado por _load_session_user (shared.py) em
toda rota autenticada. Gravações sem usuário (subida do servidor, rotinas
agendadas, login) não entram no log. Uma falha ao registrar nunca derruba a
operação em si.
"""
from contextvars import ContextVar
from datetime import datetime, timezone
import logging
import uuid

logger = logging.getLogger(__name__)

AUDIT_COLLECTION = "audit_log"

# Controle interno do sistema, não lançamento de ninguém
_SKIPPED_COLLECTIONS = {
    AUDIT_COLLECTION, "counters", "movement_locks", "scheduled_job_runs",
    "invoice_history", "freight_payment_history", "stock_audit_log",
}

# Campos que nunca vão para o log (senhas, tokens) e os que mudam sozinhos
# em toda gravação (só poluiriam a lista de alterações)
_SECRET_MARKERS = ("password", "token", "secret", "hash")
_IGNORED_CHANGE_FIELDS = {"_id", "updated_at", "updated_by", "updated_by_name"}

# delete_many apaga muitos de uma vez: guarda a cópia dos primeiros
_MAX_SNAPSHOTS = 200

# Campo que identifica o registro para quem lê o log, em ordem de preferência
_LABEL_FIELDS = (
    "invoice_number", "request_number", "payment_number", "batch_number", "order_number",
    "os_number", "proposal_number", "check_number", "container_number", "plate", "name",
    "email", "code", "description",
)

_actor: ContextVar = ContextVar("audit_actor", default=None)


def set_actor(user_id: str, user_name: str, ip: str, method: str, path: str):
    _actor.set({"user_id": user_id, "user_name": user_name, "ip": ip, "method": method, "path": path})


def current_actor():
    return _actor.get()


def _is_secret(key: str) -> bool:
    lowered = str(key).lower()
    return any(marker in lowered for marker in _SECRET_MARKERS)


def _clean(value):
    """Cópia segura para o log: sem _id do Mongo e sem campos sensíveis."""
    if isinstance(value, dict):
        return {k: ("***" if _is_secret(k) else _clean(v)) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if type(value).__name__ == "ObjectId":
        return str(value)
    return value


def _label(doc: dict):
    for field in _LABEL_FIELDS:
        value = doc.get(field)
        if value not in (None, ""):
            return str(value)[:120]
    return None


def _doc_id(doc: dict):
    return doc.get("id") or (str(doc["_id"]) if "_id" in doc else None)


def _changes(before: dict, after: dict) -> dict:
    changes = {}
    for key in set(before) | set(after):
        if key in _IGNORED_CHANGE_FIELDS:
            continue
        old, new = before.get(key), after.get(key)
        if old != new:
            changes[key] = {"from": "***" if _is_secret(key) else _clean(old), "to": "***" if _is_secret(key) else _clean(new)}
    return changes


class AuditedCollection:
    """Coleção do Motor com as gravações registradas no log. Leitura e
    qualquer outro método passam direto para a coleção real."""

    def __init__(self, raw, database: "AuditedDatabase"):
        self._raw = raw
        self._database = database

    def __getattr__(self, name):
        return getattr(self._raw, name)

    @property
    def _enabled(self) -> bool:
        return self._raw.name not in _SKIPPED_COLLECTIONS and current_actor() is not None

    async def _log(self, action: str, doc: dict = None, **extra):
        actor = current_actor()
        try:
            from shared import match_module_for_path
            entry = {
                "id": str(uuid.uuid4()),
                "at": datetime.now(timezone.utc),
                **actor,
                "module": match_module_for_path(actor["path"]),
                "collection": self._raw.name,
                "action": action,
                "doc_id": _doc_id(doc) if doc else None,
                "label": _label(doc) if doc else None,
                **extra,
            }
            await self._database._raw[AUDIT_COLLECTION].insert_one(entry)
        except Exception:
            logger.exception("Falha ao registrar o log de auditoria (%s em %s)", action, self._raw.name)

    async def _before(self, filter, **kwargs):
        try:
            return await self._raw.find_one(filter, sort=kwargs.get("sort"))
        except Exception:
            logger.exception("Falha ao ler o registro antes da alteração (%s)", self._raw.name)
            return None

    async def _after(self, before, filter, upsert):
        if before is not None:
            return await self._raw.find_one({"_id": before["_id"]})
        return await self._raw.find_one(filter) if upsert else None

    async def _log_update(self, before, after):
        if after is None:
            return
        if before is None:
            await self._log("create", after, data=_clean(after))
            return
        changes = _changes(before, after)
        if changes:
            await self._log("update", after, changes=changes)

    # ---------- criação ----------
    async def insert_one(self, document, *args, **kwargs):
        result = await self._raw.insert_one(document, *args, **kwargs)
        if self._enabled:
            await self._log("create", document, data=_clean(document))
        return result

    async def insert_many(self, documents, *args, **kwargs):
        documents = list(documents)
        result = await self._raw.insert_many(documents, *args, **kwargs)
        if self._enabled:
            for document in documents[:_MAX_SNAPSHOTS]:
                await self._log("create", document, data=_clean(document))
        return result

    # ---------- alteração ----------
    async def update_one(self, filter, update, *args, **kwargs):
        if not self._enabled:
            return await self._raw.update_one(filter, update, *args, **kwargs)
        before = await self._before(filter)
        result = await self._raw.update_one(filter, update, *args, **kwargs)
        await self._log_update(before, await self._after(before, filter, kwargs.get("upsert")))
        return result

    async def replace_one(self, filter, replacement, *args, **kwargs):
        if not self._enabled:
            return await self._raw.replace_one(filter, replacement, *args, **kwargs)
        before = await self._before(filter)
        result = await self._raw.replace_one(filter, replacement, *args, **kwargs)
        await self._log_update(before, await self._after(before, filter, kwargs.get("upsert")))
        return result

    async def find_one_and_update(self, filter, update, *args, **kwargs):
        if not self._enabled:
            return await self._raw.find_one_and_update(filter, update, *args, **kwargs)
        before = await self._before(filter, **kwargs)
        result = await self._raw.find_one_and_update(filter, update, *args, **kwargs)
        await self._log_update(before, await self._after(before, filter, kwargs.get("upsert")))
        return result

    async def update_many(self, filter, update, *args, **kwargs):
        result = await self._raw.update_many(filter, update, *args, **kwargs)
        if self._enabled and result.modified_count:
            await self._log("update_many", count=result.modified_count, filter=_clean(filter), update=_clean(update))
        return result

    # ---------- exclusão ----------
    async def delete_one(self, filter, *args, **kwargs):
        if not self._enabled:
            return await self._raw.delete_one(filter, *args, **kwargs)
        before = await self._before(filter)
        result = await self._raw.delete_one(filter, *args, **kwargs)
        if before is not None and result.deleted_count:
            await self._log("delete", before, data=_clean(before))
        return result

    async def find_one_and_delete(self, filter, *args, **kwargs):
        result = await self._raw.find_one_and_delete(filter, *args, **kwargs)
        if result is not None and self._enabled:
            await self._log("delete", result, data=_clean(result))
        return result

    async def delete_many(self, filter, *args, **kwargs):
        if not self._enabled:
            return await self._raw.delete_many(filter, *args, **kwargs)
        snapshots = await self._raw.find(filter).to_list(length=_MAX_SNAPSHOTS)
        result = await self._raw.delete_many(filter, *args, **kwargs)
        if result.deleted_count:
            for doc in snapshots:
                await self._log("delete", doc, data=_clean(doc))
        return result


class AuditedDatabase:
    """Banco do Motor que entrega as coleções já com o log de auditoria."""

    def __init__(self, raw):
        self._raw = raw
        self._collections = {}

    def _wrap(self, name, raw_collection):
        wrapped = self._collections.get(name)
        if wrapped is None or wrapped._raw is not raw_collection:
            wrapped = self._collections[name] = AuditedCollection(raw_collection, self)
        return wrapped

    def __getattr__(self, name):
        attr = getattr(self._raw, name)
        # Só coleções; o resto do banco (client, command, list_collection_names...) passa direto
        if type(attr).__name__ == "AsyncIOMotorCollection":
            return self._wrap(name, attr)
        return attr

    def __getitem__(self, name):
        return self._wrap(name, self._raw[name])

    def get_collection(self, name, *args, **kwargs):
        return AuditedCollection(self._raw.get_collection(name, *args, **kwargs), self)
