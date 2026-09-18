import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, Product, ProductMeta
from sql_app.routers.commerce import get_product_image, list_products, list_public_products, update_product
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


def add_public_products(db, count=4):
    created_at = datetime.now(timezone.utc)
    products = []
    for index in range(count):
        product = Product(
            id=f"public-product-{index}",
            name=f"Public Product {index}",
            category="Nutrition",
            description="",
            price=100 + index,
            stock=10,
            created_at=created_at - timedelta(minutes=index),
        )
        products.append(product)
        db.add(product)
        db.add(ProductMeta(product_id=product.id, product_type="metho", image_url="", mrp=100 + index))
    db.commit()
    return products


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


def test_public_products_without_pagination_params_returns_legacy_array():
    db = make_session()
    try:
        add_public_products(db, 3)
        result = list_public_products(db=db)
        assert isinstance(result, list)
        assert [item["id"] for item in result] == ["public-product-0", "public-product-1", "public-product-2"]
    finally:
        db.close()


def test_public_products_with_limit_and_offset_returns_paginated_slice():
    db = make_session()
    try:
        add_public_products(db, 4)
        result = list_public_products(limit=2, offset=1, db=db)
        assert result["offset"] == 1
        assert result["limit"] == 2
        assert result["total"] == 4
        assert result["has_more"] is True
        assert result["next_offset"] == 3
        assert [item["id"] for item in result["items"]] == ["public-product-1", "public-product-2"]
    finally:
        db.close()


def test_public_products_offset_beyond_total_returns_empty_final_page():
    db = make_session()
    try:
        add_public_products(db, 2)
        result = list_public_products(limit=2, offset=5, db=db)
        assert result["items"] == []
        assert result["total"] == 2
        assert result["has_more"] is False
        assert result["next_offset"] is None
    finally:
        db.close()


def test_public_products_pagination_excludes_hidden_products():
    db = make_session()
    try:
        add_public_products(db, 3)
        db.add(AppSetting(key="global", value_json=json.dumps({"product_hidden_map": {"public-product-1": True}})))
        db.commit()
        result = list_public_products(limit=10, offset=0, db=db)
        assert result["total"] == 2
        assert [item["id"] for item in result["items"]] == ["public-product-0", "public-product-2"]
    finally:
        db.close()
