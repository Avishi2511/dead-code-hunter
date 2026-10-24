import json

from fastapi import APIRouter, Depends

from app.deps import get_db
from app.schemas import UserCreate, UserOut
from app.services import users as user_service

router = APIRouter(tags=["users"])


@router.post("/", response_model=UserOut)
def create_user(payload: UserCreate, db=Depends(get_db)):
    return user_service.create_user(db, payload)


@router.get("/{user_id}", response_model=UserOut)
def read_user(user_id: int, db=Depends(get_db)):
    return user_service.get_user(db, user_id)


@router.get("/{user_id}", response_model=UserOut)
def read_user_v2(user_id: int, db=Depends(get_db)):
    return user_service.get_user(db, user_id)
