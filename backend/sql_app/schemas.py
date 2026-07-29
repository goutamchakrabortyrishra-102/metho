from pydantic import BaseModel


class RegisterRequest(BaseModel):
    name: str
    email: str
    phone: str
    password: str
    sponsor_code: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ProductCreate(BaseModel):
    name: str
    category: str
    price: float
    stock: int = 0
    description: str = ""
    image_url: str = ""
    product_type: str = "metho"
    partner_id: str | None = None
    mrp: float | None = None
    discount_percent: float = 0
    gst_percent: float = 0
    pricing_tiers: list[dict] | None = None


class OrderCreate(BaseModel):
    product_id: str
    quantity: int = 1
