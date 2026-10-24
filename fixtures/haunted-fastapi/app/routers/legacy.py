from fastapi import APIRouter

from app.schemas import LegacyUserOut
from app.services.legacy import legacy_lookup

router = APIRouter(prefix="/legacy")


@router.get("/lookup", response_model=LegacyUserOut)
def lookup(user_id: int):
    return legacy_lookup(user_id)


@router.delete("/{user_id}")
def remove(user_id: int):
    return {"deleted": user_id}
