from sqlalchemy import Column, Integer, String, event

from app.db import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String)

    def __repr__(self):
        return f"<User {self.email}>"

    @property
    def is_active(self):
        return bool(self.email)

    def display_name(self):
        return self.email.split("@")[0]

    def legacy_full_name(self):
        return self.email.replace("@", " at ")


@event.listens_for(User, "before_insert")
def normalize_email(mapper, connection, target):
    target.email = target.email.lower()
