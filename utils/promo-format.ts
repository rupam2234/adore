export function computeDiscount(
  discountType: "PERCENT" | "FIXED",
  discountValue: string,
  subtotal: string,
): string {
  const value = Number(discountValue);
  const total = Number(subtotal);
  const discount = discountType === "PERCENT" ? (total * value) / 100 : value;
  return String(Math.min(Math.max(Math.round(discount * 100) / 100, 0), total));
}
