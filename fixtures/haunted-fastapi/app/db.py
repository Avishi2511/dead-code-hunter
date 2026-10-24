from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


def init_db():
    from app import models  # noqa: F401

    Base.metadata.create_all(engine)
