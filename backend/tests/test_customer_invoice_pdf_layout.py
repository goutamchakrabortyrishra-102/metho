from io import BytesIO

from pypdf import PdfReader

from sql_app.routers.compat import _draw_invoice_pdf


def test_customer_invoice_pdf_includes_layout_labels():
    invoice = {
        "seller": {
            "name": "METHO Vegetable",
            "address": "Dakshin Para, Morepukur, Rishra, Hooghly, West Bengal - 712250",
            "gst_no": "19AACPM8952M1ZE",
            "pan": "AACPM8952M",
            "email": "methopvtltd@gmail.com",
            "phone": "7003805387",
        },
        "buyer": {
            "name": "rina",
            "phone": "9804110102",
            "member_code": "-",
            "shipping_address": "dakhin para",
        },
        "payment": {"method": "COD", "txn_id": "INR 17.00"},
        "invoice_no": "INV-475310FF",
        "order_no": "ORD-475310FF",
        "invoice_date": "2026-08-22T00:00:00Z",
        "status": "paid",
        "items": [{
            "product_name": "Raw Papaya",
            "product_type": "metho_vegetable",
            "hsn_sac": "0709",
            "quantity": 1,
            "price": 2.0,
            "pre_tax": 2.0,
            "cgst": 0.0,
            "sgst": 0.0,
            "subtotal": 2.0,
        }],
        "subtotal_pre_tax": 2.0,
        "total_cgst": 0.0,
        "total_sgst": 0.0,
        "delivery_charge": 15.0,
        "grand_total": 17.0,
    }

    pdf_bytes = _draw_invoice_pdf(invoice)
    reader = PdfReader(BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)

    assert pdf_bytes.startswith(b"%PDF")
    assert "METHO Vegetable" in text
    assert "Amount in Words" in text
    assert "Delivery Charge" in text
    assert "Grand Total" in text
