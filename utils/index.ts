export { db, rawQuery, pool, sql } from './db';
export {
  CART_COOKIE,
  findCartId,
  getCartDetail,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
  CartError,
} from './cart';
export type { CartLine, CartSummary } from './cart';
export {
  products,
  productVariants,
  productCategories,
  productImages,
  productReviews,
  categories,
  users,
  sessions,
} from './schema';
export { cloudinary, getPublicUrl } from './cloudinary';
export {
  getProductsForSection,
  getProductBySlug,
  getRelatedProducts,
  getActiveProductSlugs,
  getCategories,
  expandCategorySlugs,
  getFilterFacets,
} from './products';
export type { ProductSort } from './products';
export {
  CATEGORY_CHILDREN,
  CATEGORY_PARENTS,
  CATEGORY_TREE,
  ALL_CATEGORIES,
  categoryPageMetadata,
} from './categories';
export type { CategoryNode, CategoryRow, CategorySlug } from './categories';
export { formatPrice, normalizeCareInstructions } from './product-format';
export { HERO_SLIDES, HERO_AUTOPLAY_MS } from './hero-slides';
export type { HeroSlide } from './hero-slides';
export type {
  ProductCardData,
  ProductCategory,
  ProductImage,
  ProductVariantOption,
} from './product-format';
export { FIT_LABELS, EMPTY_SUMMARY, formatReviewDate } from './review-format';
export type {
  FitFeedback,
  ProductReview,
  ReviewSummary,
} from './review-format';
export {
  getApprovedReviews,
  getProductIdBySlug,
  getReviewAuthorName,
  getReviewSummary,
} from './reviews';
export type { ReviewSort } from './reviews';
export {
  evaluateReviewEligibility,
  REVIEW_BLOCK_MESSAGES,
} from './review-format';
export type { ReviewEligibility } from './review-format';
export { slugify } from './admin-schema';
export { parseShopFilters, preservedParams } from './filter-params';
export type { ParsedShopFilters } from './filter-params';
export type {
  ProductPayload,
  ProductStatus,
  FieldErrors,
} from './admin-schema';
export { removePromo, applyPromo, PromoError } from './promo';
export type { AppliedPromo } from './promo';
export { computeDiscount } from './promo-format';
export { getSessionUserId } from './request-user';
export { isAdminRequest } from './admin-auth';
export {
  createCheckoutSession,
  verifyAndConfirmPayment,
  getOrderConfirmation,
  CheckoutError,
  RECENT_ORDER_COOKIE,
} from './checkout';
export type {
  CheckoutAddress,
  CheckoutSession,
  CheckoutSessionInput,
  OrderConfirmation,
  ConfirmationItem,
} from './checkout';
export {
  computeCheckoutTotals,
  computeShippingAmount,
  GST_RATE,
  toPaise,
  SHIPPING_FLAT,
  FREE_SHIPPING_THRESHOLD,
} from './checkout-format';
export type { CheckoutTotals } from './checkout-format';

// Auth exports
export {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  getUserByEmail,
  getUserById,
  storeSession,
  revokeSession,
  isSessionValid,
  refreshTokens,
  login,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  LOGIN_HINT_COOKIE_NAME,
  type UserRole,
  type UserRow,
  type TokenPayload,
  type LoginResult,
} from './auth';
