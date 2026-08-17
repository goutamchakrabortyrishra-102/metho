from sql_app.routers.checkout import round_half_up_to_whole_rupee


def test_round_half_up_to_whole_rupee_examples():
    """Test GST-inclusive price rounding to nearest whole rupee.
    
    Rule: Decimal < 0.50 = round DOWN, Decimal >= 0.50 = round UP
    """
    cases = [
        (49.20, 49),
        (49.40, 49),
        (49.48, 49),
        (49.49, 49),
        (49.50, 50),
        (49.60, 50),
        (49.99, 50),
        (50.40, 50),
        (50.49, 50),
        (50.50, 51),
        (50.75, 51),
    ]
    for value, expected in cases:
        result = round_half_up_to_whole_rupee(value)
        assert result == expected, f"round_half_up_to_whole_rupee({value}) = {result}, expected {expected}"


def test_gst_inclusive_price_calculation():
    """Test real GST calculation with rounding.
    
    Example: Base price 49, GST 18%
    - Base: 49.00
    - GST: 49 * 0.18 = 8.82
    - Before rounding: 49 + 8.82 = 57.82
    - After rounding: 58 (using ROUND_HALF_UP)
    """
    # Test case 1: Base 49, GST 18%
    base_price = 49.00
    gst_percent = 18.0
    gst_amount = round(base_price * (gst_percent / 100.0), 2)
    pre_rounded = round(base_price + gst_amount, 2)
    final_price = round_half_up_to_whole_rupee(pre_rounded)
    
    assert gst_amount == 8.82
    assert pre_rounded == 57.82
    assert final_price == 58
    
    # Test case 2: Base 100, GST 5%
    base_price = 100.00
    gst_percent = 5.0
    gst_amount = round(base_price * (gst_percent / 100.0), 2)
    pre_rounded = round(base_price + gst_amount, 2)
    final_price = round_half_up_to_whole_rupee(pre_rounded)
    
    assert gst_amount == 5.00
    assert pre_rounded == 105.00
    assert final_price == 105
    
    # Test case 3: Base 199.99, GST 18%
    base_price = 199.99
    gst_percent = 18.0
    gst_amount = round(base_price * (gst_percent / 100.0), 2)
    pre_rounded = round(base_price + gst_amount, 2)
    final_price = round_half_up_to_whole_rupee(pre_rounded)
    
    # 199.99 * 1.18 = 235.9882 -> 236.00 (rounded to 2 decimals)
    assert gst_amount == 36.00
    assert pre_rounded == 235.99
    assert final_price == 236
if __name__ == "__main__":
    test_round_half_up_to_whole_rupee_examples()
    test_gst_inclusive_price_calculation()
    print("✓ All GST rounding tests passed!")