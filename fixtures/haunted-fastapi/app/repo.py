from app.models import User


class UserRepo:
    def __init__(self, db):
        self.db = db

    def find(self, user_id: int):
        return self.db.get(User, user_id)

    def find_old(self, email: str):
        return self.db.query(User).filter(User.email == email).first()
