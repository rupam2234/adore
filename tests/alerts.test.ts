// tests/alerts.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { alertOnCronFailure } from '../utils/alerts';

const originalFetch = global.fetch;
const originalWebhook = process.env.SLACK_WEBHOOK_URL;

describe('alertOnCronFailure', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = originalWebhook;
  });

  it('sends a Slack message when webhook is configured and status is failure', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;

    await alertOnCronFailure('auto-process', 'failure', { processed: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body);
    expect(body.text).toContain('auto-process');
    expect(body.text).toContain('failure');
    expect(body.text).toContain('processed');
  });

  it('sends alert for status "none" (no orders found) too', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as any;

    await alertOnCronFailure('retry-shiprocket', 'none', { retried: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.text).toContain('retry-shiprocket');
    expect(body.text).toContain('none');
  });

  it('skips sending when SLACK_WEBHOOK_URL is not set', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    await alertOnCronFailure('auto-process', 'failure', {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the Slack call fails', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;

    // Must resolve (not reject) even when the webhook call fails
    await expect(
      alertOnCronFailure('auto-process', 'failure', {})
    ).resolves.toBeUndefined();
  });
});