#!/usr/bin/env python3
"""
Script para importar movimentações de Flex Tank do arquivo Excel do FORTAL LOG
"""
import asyncio
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import openpyxl
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
import uuid

# Configuração do MongoDB
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'container_logistics')

# ID do cliente FORTAL LOG
FORTAL_LOG_CLIENT_ID = "dc937c75-a1d3-4b3c-8edc-8b2c35f3041c"
FORTAL_LOG_CLIENT_NAME = "FORTAL LOG"

# Caminho do arquivo Excel
EXCEL_PATH = "/tmp/estoque_fortal.xlsx"

async def get_next_movement_number(db):
    """Obtém o próximo número de movimentação"""
    last_movement = await db.flex_tank_movements.find_one(
        sort=[("movement_number", -1)],
        projection={"movement_number": 1, "_id": 0}
    )
    return (last_movement.get("movement_number", 0) if last_movement else 0) + 1

async def import_movements():
    """Importa as movimentações do Excel"""
    # Conectar ao MongoDB
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    
    # Carregar o Excel
    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb.active
    
    # Obter o próximo número de movimentação
    next_number = await get_next_movement_number(db)
    
    # Contadores
    imported = 0
    skipped = 0
    errors = 0
    
    # Processar cada linha (pulando o cabeçalho)
    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), 2):
        bag_number, bag_size, movement_date, movement_type, client_name = row
        
        # Validar dados
        if not bag_number:
            print(f"Row {row_idx}: Skipping - no bag number")
            skipped += 1
            continue
        
        # Verificar se a bolsa já existe
        existing = await db.flex_tank_movements.find_one({
            "bag_number": str(bag_number),
            "client_id": FORTAL_LOG_CLIENT_ID
        })
        
        if existing:
            print(f"Row {row_idx}: Skipping - bag {bag_number} already exists for FORTAL LOG")
            skipped += 1
            continue
        
        try:
            # Formatar tamanho da bolsa (24000 -> 24.000L)
            size_str = f"{int(bag_size):,}L".replace(",", ".") if bag_size else "24.000L"
            
            # Preparar dados da movimentação
            movement = {
                "id": str(uuid.uuid4()),
                "movement_number": next_number,
                "bag_number": str(bag_number),
                "bag_size": size_str,
                "movement_date": movement_date.isoformat() if isinstance(movement_date, datetime) else datetime.now(timezone.utc).isoformat(),
                "movement_type": movement_type.upper() if movement_type else "ENTRADA",
                "client_id": FORTAL_LOG_CLIENT_ID,
                "client_name": FORTAL_LOG_CLIENT_NAME,
                "container_number": None,
                "observations": f"Importado do Excel - Estoque FORTAL LOG",
                "created_by": "f563a515-e505-4f13-bf0c-24b03882b372",  # João Victor
                "created_by_name": "João Victor Pinheiro Vidal Paiva",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": None
            }
            
            # Inserir no banco
            await db.flex_tank_movements.insert_one(movement)
            
            imported += 1
            next_number += 1
            
            if imported % 20 == 0:
                print(f"Progress: {imported} movements imported...")
                
        except Exception as e:
            print(f"Row {row_idx}: Error importing bag {bag_number} - {e}")
            errors += 1
    
    print(f"\n{'='*50}")
    print(f"Import completed!")
    print(f"  - Imported: {imported}")
    print(f"  - Skipped: {skipped}")
    print(f"  - Errors: {errors}")
    print(f"{'='*50}")
    
    # Fechar conexão
    client.close()
    
    return imported, skipped, errors

if __name__ == "__main__":
    asyncio.run(import_movements())
