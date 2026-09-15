import json
import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from sql_app.database import Base
from sql_app.models import AppSetting, Product, ProductMeta
from export_product_catalog import export_sqlite, main, validate_catalog

FIXTURE = Path(__file__).parent / "fixtures" / "sanitized_product_catalog.json"


def make_source(path: Path) -> None:
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        db.add_all([
            Product(id="qa-product-001", name="QA Honey", category="Nutrition", description="Fake fixture product only.", price=100, stock=5),
            Product(id="qa-product-002", name="QA Tea", category="Health", description="Fake fixture product only.", price=80, stock=8),
        ])
        db.add_all([
            ProductMeta(product_id="qa-product-001", product_type="metho", image_url="data:image/png;base64,QUZBS0VfSU1BR0VfMQ==", mrp=100, discount_percent=0, gst_percent=0),
            ProductMeta(product_id="qa-product-002", product_type="metho", image_url="data:image/jpeg;base64,QUZBS0VfSU1BR0VfMg==", mrp=80, discount_percent=0, gst_percent=0),
        ])
        db.add_all([
            AppSetting(key="product_code:qa-product-001", value_json='{"code":"QA-PROD-001"}'),
            AppSetting(key="product_code:qa-product-002", value_json='{"code":"QA-PROD-002"}'),
            AppSetting(key="product_pricing_tiers", value_json="{}"),
            AppSetting(key="admin_password", value_json="must-not-export"),
            AppSetting(key="unrelated_setting", value_json="must-not-export"),
        ])
        db.commit()
    finally:
        db.close()


def test_fixture_has_only_sanitized_fake_products():
    catalog = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert len(catalog["products"]) == 2
    assert all(row["id"].startswith("qa-") for row in catalog["products"])
    assert all(row["image_url"].startswith("data:image/") for row in catalog["product_meta"])
    validate_catalog(catalog)


def test_export_is_allowlisted_and_preserves_inline_image_exactly(tmp_path):
    source = tmp_path / "source.db"
    make_source(source)
    before = source.read_bytes()
    catalog = export_sqlite(source)
    assert [row["id"] for row in catalog["products"]] == ["qa-product-001", "qa-product-002"]
    assert catalog["product_meta"][0]["image_url"] == "data:image/png;base64,QUZBS0VfSU1BR0VfMQ=="
    assert {row["key"] for row in catalog["app_settings"]} == {"product_code:qa-product-001", "product_code:qa-product-002", "product_pricing_tiers"}
    assert source.read_bytes() == before


def test_validation_rejects_duplicate_or_foreign_meta_and_forbidden_fields():
    catalog = json.loads(FIXTURE.read_text(encoding="utf-8"))
    duplicate = json.loads(json.dumps(catalog))
    duplicate["product_meta"].append(duplicate["product_meta"][0])
    with pytest.raises(ValueError, match="unique"):
        validate_catalog(duplicate)

    foreign = json.loads(json.dumps(catalog))
    foreign["product_meta"][0]["product_id"] = "not-exported"
    with pytest.raises(ValueError, match="reference"):
        validate_catalog(foreign)

    forbidden = json.loads(json.dumps(catalog))
    forbidden["products"][0]["password"] = "secret"
    with pytest.raises(ValueError, match="allowlist"):
        validate_catalog(forbidden)

    forbidden_setting = json.loads(json.dumps(catalog))
    forbidden_setting["app_settings"].append({"key": "admin_password", "value_json": "secret"})
    with pytest.raises(ValueError, match="allowlist"):
        validate_catalog(forbidden_setting)


def test_dry_run_does_not_write_output(tmp_path, capsys):
    source = tmp_path / "source.db"
    output = tmp_path / "should-not-exist.json"
    make_source(source)
    assert main(["--source", str(source), "--dry-run"]) == 0
    assert not output.exists()
    assert json.loads(capsys.readouterr().out)["valid"] is True


def test_cli_writes_only_valid_catalog(tmp_path):
    source = tmp_path / "source.db"
    output = tmp_path / "catalog.json"
    make_source(source)
    assert main(["--source", str(source), "--output", str(output)]) == 0
    catalog = json.loads(output.read_text(encoding="utf-8"))
    validate_catalog(catalog)
    assert not any("password" in json.dumps(row).lower() for row in catalog["app_settings"])


def test_source_must_be_explicit_offline_sqlite_file(tmp_path):
    with pytest.raises(ValueError, match="offline SQLite"):
        export_sqlite(tmp_path / "missing.json")
