export { db, rawQuery, pool, sql } from "./db";
export {
  CART_COOKIE,
  findCartId,
  getCartDetail,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
  CartError,
} from "./cart";
export type { CartLine, CartSummary } from "./cart";
export {
  products,
  productVariants,
  productCategories,
  productImages,
  productReviews,
  categories,
  users,
  sessions,
} from "./schema";
export { cloudinary, getPublicUrl } from "./cloudinary";
export {
  getProductsForSection,
  getProductBySlug,
  getRelatedProducts,
  getCategories,
  expandCategorySlugs,
  getFilterFacets,
} from "./products";
export type { ProductSort } from "./products";
export {
  CATEGORY_CHILDREN,
  CATEGORY_PARENTS,
  CATEGORY_TREE,
  ALL_CATEGORIES,
  categoryPageMetadata,
} from "./categories";
export type { CategoryNode, CategoryRow, CategorySlug } from "./categories";
export { formatPrice, normalizeCareInstructions } from "./product-format";
export type { ProductCardData, ProductCategory, ProductImage, ProductVariantOption } from "./product-format";
export {
  FIT_LABELS,
  EMPTY_SUMMARY,
  formatReviewDate,
} from "./review-format";
export type {
  FitFeedback,
  ProductReview,
  ReviewSummary,
} from "./review-format";
export { getApprovedReviews, getProductIdBySlug, getReviewSummary } from "./reviews";
export type { ReviewSort } from "./reviews";
export { slugify } from "./admin-schema";
export { parseShopFilters, preservedParams } from "./filter-params";
export type { ParsedShopFilters } from "./filter-params";
export type {
  ProductPayload,
  ProductStatus,
  FieldErrors,
} from "./admin-schema";
export { isAdminRequest } from "./admin-auth";

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
  type UserRole,
  type UserRow,
  type TokenPayload,
  type LoginResult,
} from "./auth";

