import json
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AppSetting, Product, ProductMeta
from sql_app.routers.checkout import create_public_order


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_weighted_vegetable_checkout_keeps_nonzero_product_amount():
    db = make_session()
    try:
        product = Product(name="Raw Papaya", category="Vegetables", price=12.0, stock=20)
        db.add(product)
        db.flush()

        db.add(
            ProductMeta(
                product_id=product.id,
                product_type="metho_vegetable",
                gst_percent=0,
            )
        )
        db.add(
            AppSetting(
                key=f"product_service_meta:{product.id}",
                value_json=json.dumps(
                    {
                        "unit_type": "kg",
                        "delivery_charge": 15,
                        "free_delivery_threshold": 0,
                    }
                ),
            )
        )
        db.commit()

        order = create_public_order(
            {
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 0.1,
                    }
                ],
                "payment_method": "razorpay",
            },
            db,
        )

        item = order["items"][0]
        assert item["unit_type"] == "kg"
        assert float(item["quantity"]) == 0.1
        assert float(item["subtotal"]) > 0
        assert float(item["price"]) > 0
        assert item["subtotal"] == 1.2
        assert order["total_amount"] == 16.2
    finally:
        db.close()
