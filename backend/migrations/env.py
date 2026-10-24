from alembic import context

from dch_api.db.models import Base
from dch_api.db.session import make_engine
from dch_api.settings import get_settings

target_metadata = Base.metadata


def run_migrations_online() -> None:
    url = context.config.get_main_option("sqlalchemy.url") or get_settings().database_url
    with make_engine(url).connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


def run_migrations_offline() -> None:
    from dch_api.db.session import normalize_url

    url = context.config.get_main_option("sqlalchemy.url") or get_settings().database_url
    context.configure(url=normalize_url(url), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
