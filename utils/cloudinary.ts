import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
    secure: true,
});

/**
 * Build the delivery URL for a product image.
 *
 * Assets in this cloud are public (access_type: "anonymous"), so a plain
 * URL is all that's needed. DO NOT use `type: "authenticated"` — that is a
 * separate asset type and returns 404 for normal uploads.
 *
 * If I switch assets to "restricted" in the Media Library, delivery
 * requires token-based authentication (NOT the s--...-- URL signature —
 * signed URLs return 401 "Unauthenticated access" for token-restricted
 * assets). To support that, set a token key in the Cloudinary console
 * (Settings → Security → Token-based authentication) and use:
 *
 *   cloudinary.url(publicId, {
 *       secure: true,
 *       sign_url: true,
 *       auth_token: { key: process.env.CLOUDINARY_TOKEN_KEY!, duration: 600 },
 *   });
 */
const getPublicUrl = (publicId: string) => {
    return cloudinary.url(publicId, {
        secure: true,
    });
};

export { getPublicUrl, cloudinary };