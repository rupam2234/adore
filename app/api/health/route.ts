import { NextResponse } from 'next/server';

export async function GET() {
  const checks = {
    database: true,
    razorpayWebhookSecret: !!process.env.RAZORPAY_WEBHOOK_SECRET,
    shiprocketWebhookToken: !!process.env.SHIPROCKET_WEBHOOK_TOKEN,
    shiprocketApiToken: !!process.env.SHIPROCKET_API,
  };

  const healthy = Object.values(checks).every(v => v === true);

  return NextResponse.json({ healthy, checks }, {
    status: healthy ? 200 : 503
  });
}