"""Offline, read-only exporter for a sanitized Product/ProductMeta catalog."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any

FORMAT = "metho-product-catalog"
VERSION = 1
OUTPUT_KEYS = {"format", "version", "source", "products", "product_meta", "app_settings"}
PRODUCT_FIELDS = {"id", "name", "category", "description", "price", "stock", "created_at"}
PRODUCT_META_FIELDS = {
    "product_id",
    "product_type",
    "image_url",
    "mrp",
    "discount_percent",
    "gst_percent",
    "created_at",
}
SETTING_KEYS = {"product_pricing_tiers", "product_youtube_map"}
SETTING_PREFIXES = ("product_code:", "product_hidden:", "product_service_meta:")
FORBIDDEN_TEXT = re.compile(
    r"(?:password|passwd|secret|token|credential|authorization|api[_-]?key|database[_-]?url)",
    re.IGNORECASE,
)


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _row_dict(row: sqlite3.Row, fields: set[str]) -> dict[str, Any]:
    return {field: _json_value(row[field]) for field in fields}


def _allowed_setting(key: str, product_ids: set[str]) -> bool:
    if key in SETTING_KEYS:
        return True
    for prefix in SETTING_PREFIXES:
        if key.startswith(prefix):
            suffix = key[len(prefix):]
            return suffix in product_ids
    return False


def _assert_safe_text(value: Any, location: str) -> None:
    if isinstance(value, str) and FORBIDDEN_TEXT.search(value):
        raise ValueError(f"Forbidden credential or secret-like value at {location}")
    if isinstance(value, dict):
        for key, nested in value.items():
            if FORBIDDEN_TEXT.search(str(key)):
                raise ValueError(f"Forbidden credential or secret-like key at {location}.{key}")
            _assert_safe_text(nested, f"{location}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _assert_safe_text(nested, f"{location}[{index}]")


def validate_catalog(catalog: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(catalog, dict) or set(catalog) != OUTPUT_KEYS:
        raise ValueError("Catalog must contain exactly the versioned catalog keys")
    if catalog["format"] != FORMAT or catalog["version"] != VERSION:
        raise ValueError("Unsupported catalog format or version")
    if catalog["source"] != "sanitized-production-catalog":
        raise ValueError("Catalog source must be sanitized-production-catalog")
    if not all(isinstance(catalog[key], list) for key in ("products", "product_meta", "app_settings")):
        raise ValueError("Catalog collections must be arrays")

    products = catalog["products"]
    product_ids = [str(row.get("id", "")) for row in products]
    if len(product_ids) != len(set(product_ids)) or any(not value for value in product_ids):
        raise ValueError("Product IDs must be unique and non-empty")
    product_id_set = set(product_ids)

    for index, row in enumerate(products):
        if not isinstance(row, dict) or set(row) != PRODUCT_FIELDS:
            raise ValueError(f"Product {index} contains fields outside the allowlist")
        _assert_safe_text(row, f"products[{index}]")

    meta_ids = [str(row.get("product_id", "")) for row in catalog["product_meta"]]
    if len(meta_ids) != len(set(meta_ids)) or any(value not in product_id_set for value in meta_ids):
        raise ValueError("ProductMeta IDs must be unique and reference an exported Product")
    for index, row in enumerate(catalog["product_meta"]):
        if not isinstance(row, dict) or set(row) != PRODUCT_META_FIELDS:
            raise ValueError(f"ProductMeta {index} contains fields outside the allowlist")
        _assert_safe_text(row, f"product_meta[{index}]")

    for index, row in enumerate(catalog["app_settings"]):
        if not isinstance(row, dict) or set(row) != {"key", "value_json"}:
            raise ValueError(f"AppSetting {index} contains fields outside the allowlist")
        key = str(row["key"])
        if not _allowed_setting(key, product_id_set):
            raise ValueError(f"AppSetting key is outside the product-display allowlist: {key}")
        _assert_safe_text(row, f"app_settings[{index}]")

    return catalog


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    rows = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
    return {row[1] for row in rows}


def export_sqlite(source: Path) -> dict[str, Any]:
    source = source.expanduser().resolve()
    if source.suffix.lower() not in {".db", ".sqlite", ".sqlite3"}:
        raise ValueError("Source must be an offline SQLite database file")
    if not source.is_file():
        raise ValueError(f"SQLite source does not exist: {source}")

    uri = f"file:{source.as_posix()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        required_tables = {"products", "product_meta"}
        available_tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        missing = required_tables - available_tables
        if missing:
            raise ValueError(f"SQLite source is missing required tables: {', '.join(sorted(missing))}")
        if not PRODUCT_FIELDS.issubset(_table_columns(connection, "products")):
            raise ValueError("products table does not contain the required export fields")
        if not PRODUCT_META_FIELDS.issubset(_table_columns(connection, "product_meta")):
            raise ValueError("product_meta table does not contain the required export fields")

        products = [
            _row_dict(row, PRODUCT_FIELDS)
            for row in connection.execute(
                "SELECT id, name, category, description, price, stock, created_at FROM products ORDER BY created_at, id"
            ).fetchall()
        ]
        product_ids = {str(row["id"]) for row in products}
        product_meta = [
            _row_dict(row, PRODUCT_META_FIELDS)
            for row in connection.execute(
                "SELECT product_id, product_type, image_url, mrp, discount_percent, gst_percent, created_at "
                "FROM product_meta ORDER BY product_id"
            ).fetchall()
            if str(row["product_id"]) in product_ids
        ]
        app_settings: list[dict[str, Any]] = []
        if "app_settings" in available_tables:
            for row in connection.execute("SELECT key, value_json FROM app_settings ORDER BY key").fetchall():
                if _allowed_setting(str(row["key"]), product_ids):
                    app_settings.append({"key": row["key"], "value_json": row["value_json"]})
    finally:
        connection.close()

    return validate_catalog(
        {
            "format": FORMAT,
            "version": VERSION,
            "source": "sanitized-production-catalog",
            "products": products,
            "product_meta": product_meta,
            "app_settings": app_settings,
        }
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export an offline sanitized Product/ProductMeta catalog")
    parser.add_argument("--source", required=True, type=Path, help="Explicit offline SQLite file path")
    parser.add_argument("--output", type=Path, help="Destination JSON path; omitted in --dry-run mode")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report without writing an output file")
    args = parser.parse_args(argv)
    if args.dry_run and args.output:
        parser.error("--output cannot be used with --dry-run")
    catalog = export_sqlite(args.source)
    if args.dry_run:
        print(json.dumps({"valid": True, "products": len(catalog["products"]), "product_meta": len(catalog["product_meta"]), "app_settings": len(catalog["app_settings"])}, separators=(",", ":")))
        return 0
    if not args.output:
        parser.error("--output is required unless --dry-run is used")
    destination = args.output.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"written": str(destination), "products": len(catalog["products"]), "product_meta": len(catalog["product_meta"]), "app_settings": len(catalog["app_settings"])}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
