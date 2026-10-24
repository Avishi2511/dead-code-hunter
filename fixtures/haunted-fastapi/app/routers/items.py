from fastapi import APIRouter, File, UploadFile

from app.config import DEFAULT_PAGE_SIZE
from app.schemas import ItemOut
from app.services import get_user
from app.utils import format_user, slugify

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("/", response_model=list[ItemOut])
def list_items(limit: int = DEFAULT_PAGE_SIZE):
    return [ItemOut(id=1, name=slugify("First item"))][:limit]


@router.get("/owner")
def item_owner(db=None):
    return format_user(get_user(db, 1))


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    return {"filename": file.filename}
