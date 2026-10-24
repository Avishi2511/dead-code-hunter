from pydantic import BaseModel, EmailStr, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_long_enough(cls, value):
        if len(value) < 8:
            raise ValueError("password too short")
        return value


class UserOut(BaseModel):
    id: int
    email: str


class ItemOut(BaseModel):
    id: int
    name: str


class LegacyUserOut(BaseModel):
    id: int
    login: str


class UnusedSchema(BaseModel):
    note: str
