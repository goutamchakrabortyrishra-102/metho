import sys
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sql_app.database import Base
from sql_app.models import AssociatePartner, PartnerProduct, PublicOrder
from sql_app.routers.checkout import _set_partner_product_meta, partner_inventory, partner_inventory_detail, partner_ledger, partner_products_update, partner_reports
import json


def make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_partner_reports_return_sector_specific_rows_without_stock_for_services():
    db = make_session()
    try:
        partner = AssociatePartner(partner_code="MTH-REPORT-001", business_name="Report Partner", email="report@example.com", active=True)
        db.add(partner)
        db.flush()
        product = PartnerProduct(partner_id=partner.id, name="Physical Item", category="General", price=100, stock=4, active=True, approval_status="approved")
        service = PartnerProduct(partner_id=partner.id, name="AC Visit", category="Home Service", price=500, stock=0, active=True, approval_status="approved")
        property_listing = PartnerProduct(partner_id=partner.id, name="Rishra Plot", category="Land Sale", price=1000000, stock=0, active=True, approval_status="approved")
        db.add_all([product, service, property_listing])
        db.flush()
        _set_partner_product_meta(db, service.id, {"listing_type": "service", "is_service": True, "service_sector": "Doorstep", "price_before_gst": 500, "gst_percent": 5, "availability": "available"})
        _set_partner_product_meta(db, property_listing.id, {"listing_type": "service", "is_service": True, "service_sector": "Property Buy & Sell", "property_type": "Plot", "property_listing_type": "For Sale", "property_status": "AVAILABLE"})
        db.commit()
        result = partner_reports(db, SimpleNamespace(role="partner", email="report@example.com", phone=""))
        assert len(result["products"]) == 1
        assert len(result["services"]) == 1
        assert len(result["property"]) == 1
        assert "opening_stock" not in result["services"][0]
        assert "purchase_cost" not in result["property"][0]
        inventory = partner_inventory(db, SimpleNamespace(role="partner", email="report@example.com", phone=""))
        product_row = next(item for item in inventory["items"] if item["item_id"] == product.id)
        assert product_row["price_before_gst"] == 100
        assert product_row["gst_percent"] == 0
        assert product_row["gst_amount"] == 0
        assert product_row["final_price"] == 100
        assert product_row["current_stock"] == 4
    finally:
        db.close()


def test_partner_ledger_has_reference_and_running_balance():
    db = make_session()
    try:
        partner = AssociatePartner(partner_code="MTH-REPORT-LEDGER", business_name="Ledger Partner", email="ledger@example.com", commission_percent=10, active=True)
        db.add(partner)
        db.flush()
        product = PartnerProduct(partner_id=partner.id, name="Item", category="General", price=100, stock=2, active=True, approval_status="approved")
        db.add(product)
        db.flush()
        order = PublicOrder(customer_user_id="", status="paid", total_amount=100, items_json=json.dumps([{"product_id": product.id, "subtotal": 100}]))
        db.add(order)
        db.commit()
        ledger = partner_ledger(db, SimpleNamespace(role="partner", email=partner.email, phone=""))
        assert ledger[0]["reference_id"] == f"order:{order.id}"
        assert ledger[0]["credit"] == ledger[0]["balance"] == 10
        assert ledger[0]["debit"] == 0
    finally:
        db.close()


def test_inventory_edit_save_refreshes_authoritative_product_values_and_service_stays_stock_free():
    db = make_session()
    try:
        partner = AssociatePartner(partner_code="MTH-INVENTORY-SAVE", business_name="Inventory Save Partner", email="inventory-save@example.com", active=True)
        db.add(partner)
        db.flush()
        product = PartnerProduct(partner_id=partner.id, name="Vegetable Pack", category="Vegetables", price=100, stock=8, active=True, approval_status="approved")
        service = PartnerProduct(partner_id=partner.id, name="AC Visit", category="Home Service", price=500, stock=0, active=True, approval_status="approved")
        db.add_all([product, service])
        db.flush()
        _set_partner_product_meta(db, product.id, {"listing_type": "product", "price_before_gst": 100, "gst_percent": 5, "purchase_cost": 60, "sku": "VEG-1", "opening_stock": 10})
        _set_partner_product_meta(db, service.id, {"listing_type": "service", "is_service": True, "service_sector": "Doorstep", "price_before_gst": 500, "gst_percent": 5, "availability": "available"})
        db.commit()
        identity = SimpleNamespace(role="partner", email=partner.email, phone="")

        partner_products_update(product.id, {"price": 125, "price_before_gst": 125, "gst_percent": 12, "purchase_cost": 70, "sku": "VEG-UPDATED", "opening_stock": "", "seating_capacity": ""}, db, identity)
        updated = partner_inventory_detail(product.id, db, identity)
        assert updated["price_before_gst"] == 125
        assert updated["gst_percent"] == 12
        assert updated["gst_amount"] == 15
        assert updated["final_price"] == 140
        assert updated["sku"] == "VEG-UPDATED"
        assert updated["current_stock"] == 8

        service_row = partner_inventory_detail(service.id, db, identity)
        assert service_row["price_before_gst"] == 500
        assert service_row["final_price"] == 525
        assert service_row["current_stock"] is None
    finally:
        db.close()
