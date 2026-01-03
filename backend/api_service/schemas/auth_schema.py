from pydantic import BaseModel, EmailStr
from typing import Optional

# ---------------------------------------------------
# User Signup
# ---------------------------------------------------
class UserSignup(BaseModel):
    company_name: str
    full_name: str
    email: EmailStr
    password: str
    role: str
    country: str

# ---------------------------------------------------
# User Login
# ---------------------------------------------------
class UserLogin(BaseModel):
    email: EmailStr
    password: str

# ---------------------------------------------------
# Token
# ---------------------------------------------------
class Token(BaseModel):
    access_token: str
    token_type: str
    email: str
    user_id: str
    refresh_token: Optional[str] = None

# ---------------------------------------------------
# Message Response
# ---------------------------------------------------
class MessageResponse(BaseModel):
    message: str
