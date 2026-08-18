import { isDeliveryServiceLike, isPropertyServiceLike, isTransportServiceLike } from "./partnerSector";

test("courier and logistics listings are never classified as transport", () => {
  const courier = { category: "Courier / Logistics", name: "Parcel Delivery", description: "Pickup and delivery service" };
  expect(isDeliveryServiceLike(courier)).toBe(true);
  expect(isTransportServiceLike(courier)).toBe(false);
});

test("transport vehicle listings remain transport", () => {
  const transport = { service_template_key: "car_rental_daily", category: "Transport", name: "Sedan Rental" };
  expect(isTransportServiceLike(transport)).toBe(true);
  expect(isDeliveryServiceLike(transport)).toBe(false);
});

test("property listings remain property semantics", () => {
  const property = { service_template_key: "plot_sale_listing", category: "Property Buy & Sell", name: "Land Listing" };
  expect(isPropertyServiceLike(property)).toBe(true);
  expect(isTransportServiceLike(property)).toBe(false);
});
