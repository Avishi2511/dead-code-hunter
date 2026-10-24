from pydantic_settings import BaseSettings

DEFAULT_PAGE_SIZE = 20
LEGACY_FLAG = True
PLUGINS = ["app.plugins.audit"]


class Settings(BaseSettings):
    app_name: str = "Haunted"
    database_url: str = "postgresql+psycopg2://haunted:haunted@localhost/haunted"
    plugins: list[str] = PLUGINS
    model_config = {"env_file": ".env"}


settings = Settings()
