#!/bin/bash

echo "=========================================="
echo "ContainerLogix Desktop - Instalação"
echo "=========================================="
echo ""

# Verificar se Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não encontrado!"
    echo "Por favor, instale Node.js 16+ antes de continuar."
    echo "Download: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js encontrado: $(node -v)"

# Verificar se está na pasta correta
if [ ! -f "package.json" ]; then
    echo "❌ Erro: Execute este script dentro da pasta /app/desktop"
    exit 1
fi

echo ""
echo "📦 Instalando dependências..."
yarn install

echo ""
echo "✅ Instalação concluída!"
echo ""
echo "=========================================="
echo "Como usar:"
echo "=========================================="
echo ""
echo "🚀 Para executar o aplicativo:"
echo "   yarn start"
echo ""
echo "📦 Para gerar instalador Windows:"
echo "   yarn build:win"
echo ""
echo "📦 Para gerar instalador macOS:"
echo "   yarn build:mac"
echo ""
echo "📦 Para gerar instalador Linux:"
echo "   yarn build:linux"
echo ""
echo "=========================================="
