from app.utils import only_tested, slugify


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_helpers():
    assert only_tested() == 42
    assert slugify("A B") == "a-b"
