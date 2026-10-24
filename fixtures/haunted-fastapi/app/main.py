from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import models as _models  # noqa: F401
from app.config import settings
from app.db import init_db
from app.routers import items, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(users.router, prefix="/api/users")
app.include_router(items.router)


@app.get("/health")
def health():
    return {"status": "ok"}
