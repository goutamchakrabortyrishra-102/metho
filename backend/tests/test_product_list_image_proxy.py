import base64
import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import Product, ProductMeta
from sql_app.routers.commerce import get_product_image, list_products, update_product
from sql_app.schemas import ProductCreate


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def add_product_with_inline_image(db):
    image_bytes = b"test-product-image"
    product = Product(id="product-image-proxy", name="Image Proxy Product", category="Nutrition", description="", price=100, stock=10)
    db.add(product)
    db.add(ProductMeta(
        product_id=product.id,
        product_type="metho",
        image_url=f"data:image/png;base64,{base64.b64encode(image_bytes).decode()}",
        mrp=100,
    ))
    db.commit()
    return product, image_bytes


def test_authenticated_product_list_does_not_return_base64_image():
    db = make_session()
    try:
        add_product_with_inline_image(db)
        item = list_products(authorization="Bearer test", db=db)[0]
        assert not item["image_url"].startswith("data:")
    finally:
        db.close()


def test_authenticated_product_list_returns_product_image_proxy_url():
    db = make_session()
    try:
        product, _image_bytes = add_product_with_inline_image(db)
        item = list_products(authorization="Bearer test", db=db)[0]
        assert item["image_url"] == f"/api/products/{product.id}/image"
    finally:
        db.close()


def test_product_image_proxy_returns_original_binary_data():
    db = make_session()
    try:
        product, image_bytes = add_product_with_inline_image(db)
        response = get_product_image(product.id, db)
        assert response.body == image_bytes
        assert response.media_type == "image/png"
    finally:
        db.close()


def test_product_update_with_own_image_proxy_preserves_stored_base64():
    db = make_session()
    try:
        product, _image_bytes = add_product_with_inline_image(db)
        original = db.get(ProductMeta, product.id).image_url
        update_product(
            product.id,
            ProductCreate(
                name="Updated Product Name",
                category=product.category,
                price=100,
                stock=product.stock,
                mrp=100,
                image_url=f"/api/products/{product.id}/image",
                product_type="metho",
            ),
            db,
            SimpleNamespace(role="admin"),
        )
        assert db.get(ProductMeta, product.id).image_url == original
        assert db.get(Product, product.id).name == "Updated Product Name"
    finally:
        db.close()
