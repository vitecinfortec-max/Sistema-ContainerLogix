#!/usr/bin/env python3
"""
Provisiona uma instância nova e isolada do ContainerLogix para um cliente:
- Cria um banco (novo DB_NAME) no mesmo cluster MongoDB Atlas
- Cria o backend no Render (novo Web Service, mesmo repositório do GitHub)
- Cria o frontend na Vercel (novo projeto, mesmo repositório do GitHub)
- Conecta as duas pontas (CORS_ORIGINS <-> REACT_APP_BACKEND_URL)

Não mexe em nada do cliente principal (J.A Logística) - cria tudo do zero,
isolado, usando o mesmo código-fonte (mesmo repo/branch).

As chamadas HTTP passam por 'curl' (via subprocess) em vez da biblioteca
'requests' - nessa máquina, o Python não consegue negociar TLS direto com
api.render.com/api.vercel.com (erro SSLEOFError), mas o curl (usa o SChannel
do Windows) funciona normalmente para os mesmos hosts.

Uso:
    export RENDER_API_KEY=rnd_xxx
    export VERCEL_API_TOKEN=vcp_xxx
    export MONGO_CLUSTER_URL="mongodb+srv://usuario:senha@cluster0.xxxxx.mongodb.net"
    python provision_client.py --name "Transleo Logística" --slug transleo
"""
import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.request
import urllib.error

GITHUB_REPO = "vitecinfortec-max/Sistema-ContainerLogix"
GITHUB_BRANCH = "main"

RENDER_API = "https://api.render.com/v1"
VERCEL_API = "https://api.vercel.com"


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"ERRO: variável de ambiente {name} não definida.")
        sys.exit(1)
    return value


def curl_json(method: str, url: str, headers: dict, body: dict = None, params: dict = None):
    """Faz uma chamada HTTP via curl (subprocess) e retorna (status_code, dict).
    Usado no lugar de 'requests' porque a lib Python não consegue fechar o
    handshake TLS com api.render.com/api.vercel.com nesta máquina."""
    if params:
        qs = "&".join(f"{k}={urllib.request.quote(str(v))}" for k, v in params.items() if v is not None)
        if qs:
            url = f"{url}?{qs}"

    cmd = ["curl", "-s", "-X", method, url, "-w", "\n__STATUS__%{http_code}"]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"curl falhou (exit {result.returncode}): {result.stderr}")

    output = result.stdout
    marker = "\n__STATUS__"
    idx = output.rfind(marker)
    if idx == -1:
        raise RuntimeError(f"Resposta inesperada do curl: {output[:300]}")
    body_text = output[:idx]
    status_code = int(output[idx + len(marker):].strip())

    parsed = None
    if body_text.strip():
        try:
            parsed = json.loads(body_text)
        except json.JSONDecodeError:
            parsed = body_text
    return status_code, parsed


class Provisioner:
    def __init__(self, slug: str, company_name: str, render_plan: str = "starter"):
        self.slug = slug
        self.company_name = company_name
        self.render_plan = render_plan
        self.render_key = require_env("RENDER_API_KEY")
        self.vercel_token = require_env("VERCEL_API_TOKEN")
        self.mongo_cluster_url = require_env("MONGO_CLUSTER_URL")

        self.render_headers = {
            "Authorization": f"Bearer {self.render_key}",
            "Accept": "application/json",
        }
        self.vercel_headers = {
            "Authorization": f"Bearer {self.vercel_token}",
        }

        self.db_name = f"containerlogix_{self.slug}"
        self.jwt_secret = secrets.token_hex(32)
        self.render_owner_id = None
        self.vercel_team_id = None
        self.render_service_id = None
        self.render_service_url = None
        self.vercel_project_id = None

    # ---------- helpers de conta ----------

    def fetch_render_owner(self):
        status, data = curl_json("GET", f"{RENDER_API}/owners", self.render_headers, params={"limit": 1})
        if status >= 300 or not data:
            raise RuntimeError(f"Falha ao buscar workspace do Render: {status} {data}")
        self.render_owner_id = data[0]["owner"]["id"]
        print(f"[Render] workspace: {data[0]['owner']['name']} ({self.render_owner_id})")

    def fetch_vercel_team(self):
        status, data = curl_json("GET", f"{VERCEL_API}/v2/user", self.vercel_headers)
        if status >= 300:
            raise RuntimeError(f"Falha ao buscar conta da Vercel: {status} {data}")
        self.vercel_team_id = data["user"].get("defaultTeamId")
        print(f"[Vercel] team: {self.vercel_team_id}")

    # ---------- Render ----------

    def create_render_service(self, vercel_frontend_url: str):
        name = f"containerlogix-{self.slug}-backend"
        body = {
            "type": "web_service",
            "name": name,
            "ownerId": self.render_owner_id,
            "repo": f"https://github.com/{GITHUB_REPO}",
            "branch": GITHUB_BRANCH,
            "autoDeploy": "yes",
            "serviceDetails": {
                "runtime": "python",
                "plan": self.render_plan,
                "region": "oregon",
                "envSpecificDetails": {
                    "buildCommand": "pip install -r backend/requirements.txt",
                    "startCommand": "cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT",
                },
                "disk": {
                    "name": f"{self.slug}-uploads",
                    "mountPath": "/opt/render/project/src/uploads",
                    "sizeGB": 10,
                },
                "healthCheckPath": "/api/",
            },
            "envVars": [
                {"key": "PYTHON_VERSION", "value": "3.11.9"},
                {"key": "MONGO_URL", "value": self.mongo_cluster_url},
                {"key": "DB_NAME", "value": self.db_name},
                {"key": "CORS_ORIGINS", "value": vercel_frontend_url},
                {"key": "JWT_SECRET_KEY", "value": self.jwt_secret},
            ],
        }
        status, data = curl_json("POST", f"{RENDER_API}/services", self.render_headers, body=body)
        if status >= 300:
            raise RuntimeError(f"Falha ao criar serviço no Render: {status} {data}")
        service = data["service"]
        self.render_service_id = service["id"]
        self.render_service_url = service["serviceDetails"]["url"]
        print(f"[Render] serviço criado: {self.render_service_url}")

    # ---------- Vercel ----------

    def create_vercel_project(self):
        name = f"containerlogix-{self.slug}"
        body = {
            "name": name,
            "framework": "create-react-app",
            "rootDirectory": "frontend",
            "gitRepository": {"type": "github", "repo": GITHUB_REPO},
        }
        status, data = curl_json(
            "POST", f"{VERCEL_API}/v11/projects", self.vercel_headers,
            body=body, params={"teamId": self.vercel_team_id},
        )
        if status >= 300:
            raise RuntimeError(f"Falha ao criar projeto na Vercel: {status} {data}")
        self.vercel_project_id = data["id"]
        print(f"[Vercel] projeto criado: {name} ({self.vercel_project_id})")

        status, data = curl_json(
            "PATCH", f"{VERCEL_API}/v9/projects/{self.vercel_project_id}", self.vercel_headers,
            body={"ssoProtection": None}, params={"teamId": self.vercel_team_id},
        )
        if status >= 300:
            print(f"[Vercel] aviso: não consegui desativar SSO automaticamente ({status}): {data}")
        else:
            print("[Vercel] proteção SSO desativada")

        return f"https://{name}.vercel.app"

    def set_vercel_env(self, key: str, value: str):
        status, data = curl_json(
            "POST", f"{VERCEL_API}/v10/projects/{self.vercel_project_id}/env", self.vercel_headers,
            body={"key": key, "value": value, "type": "plain", "target": ["production"]},
            params={"teamId": self.vercel_team_id},
        )
        if status >= 300:
            raise RuntimeError(f"Falha ao definir env var {key} na Vercel: {status} {data}")
        print(f"[Vercel] env var definida: {key}")

    def trigger_vercel_deploy(self):
        name = f"containerlogix-{self.slug}"
        body = {
            "name": name,
            "project": self.vercel_project_id,
            "target": "production",
            "gitSource": {"type": "github", "repo": GITHUB_REPO, "ref": GITHUB_BRANCH},
        }
        status, data = curl_json(
            "POST", f"{VERCEL_API}/v13/deployments", self.vercel_headers,
            body=body, params={"teamId": self.vercel_team_id},
        )
        if status >= 300:
            raise RuntimeError(f"Falha ao disparar deploy na Vercel: {status} {data}")
        print(f"[Vercel] deploy disparado: {data.get('url')}")
        return data

    def wait_render_ready(self, timeout_seconds=600):
        print("[Render] aguardando o serviço ficar pronto (build pode levar alguns minutos)...")
        start = time.time()
        while time.time() - start < timeout_seconds:
            try:
                status, _ = curl_json("GET", f"{self.render_service_url}/api/", {})
                if status == 200:
                    print("[Render] serviço no ar")
                    return True
            except Exception:
                pass
            time.sleep(15)
        print("[Render] AVISO: tempo esgotado esperando o serviço subir - confira manualmente no dashboard")
        return False

    # ---------- fluxo principal ----------

    def run(self):
        print(f"=== Provisionando '{self.company_name}' (slug: {self.slug}) ===\n")
        self.fetch_render_owner()
        self.fetch_vercel_team()

        vercel_url_guess = self.create_vercel_project()
        self.create_render_service(vercel_url_guess)
        self.set_vercel_env("REACT_APP_BACKEND_URL", self.render_service_url)
        self.trigger_vercel_deploy()
        self.wait_render_ready()

        print("\n=== Provisionamento concluído ===")
        print(f"Empresa:        {self.company_name}")
        print(f"Banco (Mongo):  {self.db_name}  (mesmo cluster, banco próprio)")
        print(f"Backend:        {self.render_service_url}")
        print(f"Frontend:       {vercel_url_guess}")
        print(f"JWT_SECRET_KEY: {self.jwt_secret}  (guarde num lugar seguro)")
        print("\nPróximos passos manuais (não dá pra automatizar):")
        print("1. Se o cliente tiver domínio próprio, adicionar em:")
        print(f"   https://vercel.com/dashboard -> projeto containerlogix-{self.slug} -> Domains")
        print("   (e depois atualizar CORS_ORIGINS no Render com esse domínio)")
        print("2. Criar a primeira conta no sistema pelo /register e promover a admin")
        print("   (mesmo processo do usuário master que fizemos hoje)")


def main():
    parser = argparse.ArgumentParser(description="Provisiona uma instância nova do ContainerLogix para um cliente")
    parser.add_argument("--name", required=True, help="Nome da empresa cliente (ex: 'Transleo Logística')")
    parser.add_argument("--slug", help="Identificador curto (ex: 'transleo'). Se omitido, gera a partir do nome.")
    parser.add_argument(
        "--plan", default="starter", choices=["free", "starter", "standard"],
        help="Plano do backend no Render (default: starter). Use 'free' só para testar o script."
    )
    args = parser.parse_args()

    slug = slugify(args.slug or args.name)
    if not slug:
        print("ERRO: não foi possível gerar um slug válido a partir do nome/slug informado.")
        sys.exit(1)

    provisioner = Provisioner(slug=slug, company_name=args.name, render_plan=args.plan)
    provisioner.run()


if __name__ == "__main__":
    main()
