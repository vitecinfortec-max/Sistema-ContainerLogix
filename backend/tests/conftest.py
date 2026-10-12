"""Configuração comum dos testes.

Os testes de test_rules_unit.py importam os módulos do backend direto (sem
servidor no ar e sem banco) - auth.py e shared.py exigem essas variáveis já
na importação. setdefault não mexe em nada que o ambiente já tenha definido;
o MONGO_URL de mentira nunca é usado, porque o cliente Mongo só conecta na
primeira consulta e esses testes não fazem nenhuma.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("JWT_SECRET_KEY", "chave-somente-para-testes")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "containerlogix_testes_unitarios")
