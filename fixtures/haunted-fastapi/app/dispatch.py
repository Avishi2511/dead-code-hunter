import sys


def handle_created(event):
    return event


def handle_deleted(event):
    return event


def dispatch(name, event):
    return getattr(sys.modules[__name__], f"handle_{name}")(event)
