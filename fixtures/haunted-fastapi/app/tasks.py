from celery import Celery

from app.dispatch import dispatch

celery_app = Celery("haunted")


@celery_app.task
def send_welcome_email(user_id):
    return dispatch("created", user_id)
