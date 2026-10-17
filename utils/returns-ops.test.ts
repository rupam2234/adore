import { notifyOrderShipped } from './returns-ops';
import { rawQuery } from '@/utils/db';
import { fetchShiprocketDocuments } from '@/utils/shipping';
import { enqueueAndNotify } from './email-queue';
import { buildDedupeKey } from './email-lifecycle';

// Mock dependencies
jest.mock('@/utils/db');
jest.mock('@/utils/shipping');
jest.mock('./email-queue');
jest.mock('./email-lifecycle');

const mockedRawQuery = rawQuery as jest.MockedFunction<typeof rawQuery>;
const mockedFetchShiprocketDocuments = fetchShiprocketDocuments as jest.MockedFunction<typeof fetchShiprocketDocuments>;
const mockedEnqueueAndNotify = enqueueAndNotify as jest.MockedFunction<typeof enqueueAndNotify>;
const mockedBuildDedupeKey = buildDedupeKey as jest.MockedFunction<typeof buildDedupeKey>;

describe('notifyOrderShipped', () => {
  const orderId = 'order-123';
  const orderNumber = 'AD-1001';
  const customerEmail = 'customer@example.com';
  const firstName = 'John';
  const lastName = 'Doe';
  const shiprocketOrderId = 'sr_98765';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock rawQuery for order and customer
    mockedRawQuery.mockImplementation((query) => {
      if (query.includes('FROM orders o')) {
        return Promise.resolve([
          {
            email: customerEmail,
            first_name: firstName,
            last_name: lastName,
            shiprocket_order_id: shiprocketOrderId,
          },
        ]);
      }
      if (query.includes('FROM order_items')) {
        return Promise.resolve([
          { product_name: 'Test Product', quantity: 2 },
        ]);
      }
      return Promise.resolve([]);
    });

    mockedBuildDedupeKey.mockReturnValue('dedupe-key');
    mockedEnqueueAndNotify.mockResolvedValue({ success: true });
  });

  it('should include invoiceUrl in payload when Shiprocket order ID present and document fetch succeeds', async () => {
    const invoiceUrl = 'https://shiprocket.co/invoice/123.pdf';
    mockedFetchShiprocketDocuments.mockResolvedValue({ invoiceUrl });

    await notifyOrderShipped({
      orderId,
      orderNumber,
      awb: '1234567890',
      courierName: 'CourierX',
    });

    expect(mockedEnqueueAndNotify).toHaveBeenCalledTimes(1);
    const callArgs = mockedEnqueueAndNotify.mock.calls[0][0];
    expect(callArgs.flow).toBe('order_shipped');
    expect(callArgs.to).toBe(customerEmail);
    expect(callArgs.dedupeKey).toBe('dedupe-key');
    expect(callArgs.payload).toMatchObject({
      customerName: `${firstName} ${lastName}`,
      orderNumber,
      trackingUrl: `https://shiprocket.co/tracking/1234567890`,
      courierName: 'CourierX',
      invoiceUrl,
      items: [{ name: 'Test Product', qty: 2 }],
    });
  });

  it('should set invoiceUrl to undefined when fetchShiprocketDocuments fails', async () => {
    mockedFetchShiprocketDocuments.mockRejectedValue(new Error('Failed'));

    await notifyOrderShipped({
      orderId,
      orderNumber,
    });

    expect(mockedEnqueueAndNotify).toHaveBeenCalledTimes(1);
    const callArgs = mockedEnqueueAndNotify.mock.calls[0][0];
    expect(callArgs.payload.invoiceUrl).toBeUndefined();
  });

  it('should not call fetchShiprocketDocuments when shiprocket_order_id is null', async () => {
    // Override rawQuery to return null shiprocket_order_id
    mockedRawQuery.mockImplementationOnce((query) => {
      if (query.includes('FROM orders o')) {
        return Promise.resolve([
          {
            email: customerEmail,
            first_name: firstName,
            last_name: lastName,
            shiprocket_order_id: null,
          },
        ]);
      }
      if (query.includes('FROM order_items')) {
        return Promise.resolve([
          { product_name: 'Test Product', quantity: 1 },
        ]);
      }
      return Promise.resolve([]);
    });

    await notifyOrderShipped({
      orderId,
      orderNumber,
    });

    expect(mockedFetchShiprocketDocuments).not.toHaveBeenCalled();
    const callArgs = mockedEnqueueAndNotify.mock.calls[0][0];
    expect(callArgs.payload.invoiceUrl).toBeUndefined();
  });
});