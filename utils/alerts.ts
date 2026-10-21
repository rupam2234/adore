// utils/alerts.ts
export async function alertOnCronFailure(endpoint: string, status: string, details: unknown) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    console.warn('[alert] SLACK_WEBHOOK_URL not set; skipping alert');
    return;
  }
  const message = `🚨 Cron *${endpoint}* finished with status *${status}*\n\`\`\`${JSON.stringify(details, null, 2)}\`\`\``;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
  } catch (e) {
    console.error('[alert] Failed to send Slack alert:', e);
  }
}