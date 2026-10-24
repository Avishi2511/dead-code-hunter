from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import User


def slugify(text: str) -> str:
    return text.lower().replace(" ", "-")


def format_user(user: "User") -> str:
    return user.display_name()


def deprecated_slug(text: str) -> str:
    return text.strip()


class UnusedHelper:
    def __init__(self):
        self.value = 1


def only_tested() -> int:
    return 42


def parse(value):
    return int(value)
    print("never reached")


def feature():
    if False:
        print("legacy feature")
    return True
