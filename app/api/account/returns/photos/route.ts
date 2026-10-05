import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/utils/request-user';
import { rateLimit } from '@/utils/rate-limit';
import { cloudinary } from '@/utils';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Uploads cost real bandwidth + storage, so they get their own tighter cap. */
const UPLOAD_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };

/**
 * POST /api/account/returns/photos — evidence for a damage or wrong-item claim.
 * Photos go to Cloudinary, not base64 jsonb: megabytes of binary in Postgres
 * bloats storage and every row read. Separate from the admin-only /api/upload.
 */
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const limit = rateLimit(`return-photo:${userId}`, UPLOAD_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many uploads. Please try again shortly.' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  // The client guard is a convenience; this is the gate.
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'Photos must be JPEG, PNG or WebP.' },
      { status: 415 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: 'That photo is larger than 5 MB.' },
      { status: 413 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await cloudinary.uploader.upload(
      `data:${file.type};base64,${buffer.toString('base64')}`,
      {
        folder: 'adore/returns',
        use_filename: false,
        unique_filename: true,
        overwrite: false,
        // Evidence must survive unaltered — never recompress it.
        transformation: [{ quality: 'auto' }],
      }
    );

    return NextResponse.json(
      { url: result.secure_url, publicId: result.public_id },
      { status: 201 }
    );
  } catch (error) {
    console.error('return photo upload failed:', error);
    return NextResponse.json(
      { error: 'Could not upload that photo. Please try again.' },
      { status: 500 }
    );
  }
}
