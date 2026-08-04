import { buildUpiPaymentUri } from "./utils";

describe("buildUpiPaymentUri", () => {
  it("builds a UPI payment URI with the payee and amount", () => {
    expect(buildUpiPaymentUri("merchant@upi", "METHO Store", 250)).toBe(
      "upi://pay?pa=merchant%40upi&pn=METHO+Store&am=250.00&cu=INR"
    );
  });

  it("returns an empty string when no UPI ID is provided", () => {
    expect(buildUpiPaymentUri("", "METHO Store", 250)).toBe("");
  });
});
