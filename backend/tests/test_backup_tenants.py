"""
scripts/backup_tenants.py: o backup leva o banco central e o de cada
empresa, a restauração devolve os mesmos registros (datas como data) num
banco novo, e recusa restaurar por cima de banco em uso ou com dados.
"""
import argparse
import json
from datetime import datetime, timezone

import mongomock
import pytest

from scripts import backup_tenants as bt


@pytest.fixture
def mongo(monkeypatch):
    client = mongomock.MongoClient(tz_aware=True)
    client[bt.CENTRAL_DB_NAME].tenants.insert_many([
        {"slug": "ja", "name": "J.A", "db_name": "containerlogix_ja"},
        {"slug": "tll", "name": "TLL", "db_name": "containerlogix_tll"},
    ])
    client["containerlogix_ja"].movements.insert_many([
        {"id": f"m{i}", "container_number": f"MSCU{i:07d}", "created_at": datetime(2026, 11, 1, 12, i, tzinfo=timezone.utc)}
        for i in range(3)
    ])
    client["containerlogix_ja"].clients.insert_one({"id": "c1", "name": "Alfa"})
    client["containerlogix_tll"].movements.insert_one({"id": "t1"})
    client["fora_do_cadastro"].coisas.insert_one({"x": 1})
    monkeypatch.setattr(bt, "connect", lambda: client)
    return client


def _backup(tmp_path):
    bt.cmd_backup(argparse.Namespace(out=str(tmp_path), keep=0))
    day = next(p for p in tmp_path.iterdir() if p.is_dir())
    return day, json.loads((day / "manifest.json").read_text(encoding="utf-8"))


def test_backup_covers_central_and_every_tenant(mongo, tmp_path):
    _day, manifest = _backup(tmp_path)
    dbs = manifest["databases"]
    assert set(dbs) == {bt.CENTRAL_DB_NAME, "containerlogix_ja", "containerlogix_tll"}
    assert dbs["containerlogix_ja"] == {"clients": 1, "movements": 3}
    assert dbs[bt.CENTRAL_DB_NAME] == {"tenants": 2}


def test_restore_into_new_database_keeps_types(mongo, tmp_path):
    day, _ = _backup(tmp_path)
    bt.cmd_restore(argparse.Namespace(source=str(day), db="containerlogix_ja", into="restore_teste"))
    restored = mongo["restore_teste"]
    assert restored.movements.count_documents({}) == 3
    doc = restored.movements.find_one({"id": "m2"})
    assert isinstance(doc["created_at"], datetime)
    assert doc["created_at"].replace(tzinfo=timezone.utc) == datetime(2026, 11, 1, 12, 2, tzinfo=timezone.utc)


def test_restore_refuses_databases_in_use_or_with_data(mongo, tmp_path):
    day, _ = _backup(tmp_path)
    for target in ("containerlogix_tll", bt.CENTRAL_DB_NAME, "containerlogix_ja", "fora_do_cadastro"):
        with pytest.raises(SystemExit):
            bt.cmd_restore(argparse.Namespace(source=str(day), db="containerlogix_ja", into=target))
    assert mongo["containerlogix_tll"].movements.count_documents({}) == 1
