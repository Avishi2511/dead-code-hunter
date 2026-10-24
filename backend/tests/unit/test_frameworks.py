from __future__ import annotations

import textwrap

MAIN = "if __name__ == '__main__': main()"
APP_MODULE = textwrap.dedent(
    """
    from fastapi import FastAPI
    from routers import users

    app = FastAPI()
    app.include_router(users.router, prefix='/api')
"""
)


def routes(s) -> dict[str, str]:
    return {f.name: f.evidence[0].code for f in s.find("unused_route")}


def test_mounted_router_routes_are_live_and_unmounted_are_dead(scan):
    s = scan(
        {
            "main.py": APP_MODULE + "\nfrom routers import orphan\n",
            "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
            "routers/__init__.py": "",
            "routers/users.py": """
                from fastapi import APIRouter
                router = APIRouter(prefix='/users')

                @router.get('/{id}')
                def read(id): return id
            """,
            "routers/orphan.py": """
                from fastapi import APIRouter
                router = APIRouter()

                @router.post('/x')
                def create(): return 1
            """,
        }
    )
    assert routes(s) == {"POST /x": "unmounted_router"}
    assert s.find("unused_function") == []


def test_nested_router_prefixes_compose(scan):
    s = scan(
        {
            "main.py": """
                from fastapi import FastAPI, APIRouter
                import inner

                app = FastAPI()
                outer = APIRouter(prefix='/o')
                outer.include_router(inner.router, prefix='/mid')
                app.include_router(outer, prefix='/v1')

                @inner.router.get('/leaf')
                def leaf(): ...
            """,
            "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
            "inner.py": """
                from fastapi import APIRouter
                router = APIRouter(prefix='/in')
            """,
        }
    )
    assert s.find("unused_route") == []


def test_shadowed_route_is_flagged_with_high_confidence(scan):
    s = scan(
        {
            "main.py": """
                from fastapi import FastAPI
                app = FastAPI()

                @app.get('/items/{item_id}')
                def first(item_id): ...

                @app.get('/items/{other}')
                def second(other): ...
            """,
            "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
        }
    )
    (finding,) = s.find("unused_route")
    assert finding.confidence == 95
    assert "first" not in finding.name
    assert finding.evidence[0].code == "shadowed_route"


def test_depends_targets_stay_alive_only_through_live_routes(scan):
    s = scan(
        {
            "main.py": """
                from fastapi import FastAPI, Depends
                app = FastAPI()

                def get_db(): ...
                def get_admin(): ...

                @app.get('/')
                def index(db=Depends(get_db)): ...
            """,
            "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
        }
    )
    assert s.names("unused_function") == {"get_admin"}


def test_app_in_non_entry_module_falls_back_to_all_apps(scan):
    s = scan(
        {
            "svc.py": """
                from fastapi import FastAPI
                app = FastAPI()

                @app.get('/')
                def index(): ...
            """,
        }
    )
    assert s.find("unused_route") == []
    assert any("No ASGI entry point" in w for w in s.result.warnings)


def test_mounted_subapp_routes_are_live(scan):
    s = scan(
        {
            "main.py": """
                from fastapi import FastAPI
                import admin

                app = FastAPI()
                app.mount('/admin', admin.admin_app)
            """,
            "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
            "admin.py": """
                from fastapi import FastAPI
                admin_app = FastAPI()

                @admin_app.get('/stats')
                def stats(): ...
            """,
        }
    )
    assert s.find("unused_route") == []


def test_unresolved_include_weakens_unmounted_confidence(scan):
    s = scan(
        {
            "main.py": """
                from fastapi import FastAPI
                import extra

                app = FastAPI()
                for r in make_routers():
                    app.include_router(r)
            """,
            "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
            "extra.py": """
                from fastapi import APIRouter
                router = APIRouter()

                @router.get('/e')
                def e(): ...
            """,
        }
    )
    (finding,) = s.find("unused_route")
    assert finding.level != "high"
    assert "dynamic_include" in {e.code for e in finding.evidence}


def test_add_api_route_registers_handler(scan):
    s = scan(
        {
            "main.py": """
                from fastapi import FastAPI
                app = FastAPI()

                def handler(): ...

                app.add_api_route('/h', handler, methods=['GET'])
            """,
            "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
        }
    )
    assert s.find() == []


def test_pydantic_validators_and_sqlalchemy_hooks_stay_alive(scan):
    s = scan(
        {
            "main.py": f"""
                from pydantic import BaseModel, field_validator
                from sqlalchemy import event
                from sqlalchemy.orm import validates

                class Schema(BaseModel):
                    name: str

                    @field_validator('name')
                    @classmethod
                    def check(cls, v): return v

                    def unused_helper(self): ...

                class Model:
                    @validates('x')
                    def validate_x(self, key, value): return value

                @event.listens_for(Model, 'before_insert')
                def hook(mapper, conn, target): ...

                def main():
                    Schema(name='x'); Model()

                {MAIN}
            """,
        }
    )
    assert s.names("unused_method") == {"Schema.unused_helper"}
    assert s.names("unused_function") == set()


def test_celery_tasks_are_roots_and_keep_their_module(scan):
    s = scan(
        {
            "tasks.py": """
                from celery import Celery, shared_task
                app = Celery('x')

                @app.task
                def send(): ...

                @shared_task
                def other(): ...

                def helper(): ...
            """,
        }
    )
    assert s.names("unused_function") == {"helper"}
    assert s.names("unused_module") == set()


def test_event_hooks_on_app_are_kept(scan):
    s = scan(
        {
            "main.py": """
                from fastapi import FastAPI
                app = FastAPI()

                @app.on_event('startup')
                def boot(): ...

                @app.exception_handler(ValueError)
                def on_error(request, exc): ...
            """,
            "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
        }
    )
    assert s.find() == []


def test_route_full_paths_compose_through_nested_includes():
    from conftest import make_tree
    from dch.scan import scan_tree

    result = scan_tree(
        make_tree(
            {
                "main.py": """
                    from fastapi import FastAPI, APIRouter
                    import inner

                    app = FastAPI()
                    outer = APIRouter(prefix='/o')
                    outer.include_router(inner.router, prefix='/mid')
                    app.include_router(outer, prefix='/v1')
                """,
                "Dockerfile": 'CMD ["uvicorn", "main:app"]\n',
                "inner.py": """
                    from fastapi import APIRouter
                    router = APIRouter(prefix='/in')

                    @router.get('/leaf')
                    def leaf(): ...
                """,
            }
        ),
        include_graph=True,
    )
    assert result.graph is not None
    assert {n.name for n in result.graph.nodes if n.kind == "route"} == {"GET /v1/o/mid/in/leaf"}
    assert result.findings == []
