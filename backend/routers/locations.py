import json
from functools import lru_cache

from fastapi import APIRouter, Depends
from typing import List

from shared import ROOT_DIR, get_current_active_user

api_router = APIRouter(prefix="/api")

_LOCATIONS_FILE = ROOT_DIR / "data" / "br_locations.json"


@lru_cache(maxsize=1)
def _load_locations():
    with open(_LOCATIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


@api_router.get("/locations/states")
async def get_states(current_user: dict = Depends(get_current_active_user)):
    return _load_locations()["states"]


@api_router.get("/locations/cities")
async def get_cities(uf: str, current_user: dict = Depends(get_current_active_user)):
    return _load_locations()["citiesByUf"].get(uf.upper(), [])
