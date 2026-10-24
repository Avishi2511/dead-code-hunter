import hashlib
import os

from app.models import User
from app.repo import UserRepo
from app.schemas import UserCreate


def create_user(db, payload: UserCreate) -> User:
    user = User(email=payload.email)
    db.add(user)
    return user


def get_user(db, user_id: int) -> User | None:
    repo = UserRepo(db)
    return repo.find(user_id)


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()
