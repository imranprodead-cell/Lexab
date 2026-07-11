// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/notifications.api', () => ({
  notificationsApi: { list: vi.fn(), markRead: vi.fn() },
}));

import { notificationsApi } from '@/api/notifications.api';
import { useNotificationsStore } from './useNotificationsStore';

const mockList = notificationsApi.list as ReturnType<typeof vi.fn>;
const mockMarkRead = notificationsApi.markRead as ReturnType<typeof vi.fn>;

/** Let the `.catch()` rollback microtask run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

async function seedTwoUnread() {
  mockList.mockResolvedValue([
    { id: 'n1', icon: 'check', title: 'A', read: false, time: '' },
    { id: 'n2', icon: 'check', title: 'B', read: false, time: '' },
  ]);
  await useNotificationsStore.getState().refresh();
}

const read = (id: string) => useNotificationsStore.getState().items.find((n) => n.id === id)?.read;

describe('notifications store — optimistic read with rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationsStore.setState({ items: [] });
  });

  it('markRead is optimistic, then rolls back when the server rejects', async () => {
    await seedTwoUnread();
    expect(useNotificationsStore.getState().unread()).toBe(2);

    mockMarkRead.mockRejectedValue(new Error('offline'));
    useNotificationsStore.getState().markRead('n1');
    expect(read('n1')).toBe(true); // optimistic immediately

    await flush();
    expect(read('n1')).toBe(false); // rolled back — server rejected
    expect(useNotificationsStore.getState().unread()).toBe(2);
  });

  it('markRead stays read when the server succeeds', async () => {
    await seedTwoUnread();
    mockMarkRead.mockResolvedValue(undefined);
    useNotificationsStore.getState().markRead('n1');
    await flush();
    expect(read('n1')).toBe(true);
    expect(useNotificationsStore.getState().unread()).toBe(1);
  });

  it('markAllRead rolls back every previously-unread item on reject', async () => {
    await seedTwoUnread();
    // n2 was already read? no — both unread; make n2 read first via a success.
    mockMarkRead.mockResolvedValueOnce(undefined);
    useNotificationsStore.getState().markRead('n2');
    await flush();
    expect(useNotificationsStore.getState().unread()).toBe(1); // only n1 unread now

    mockMarkRead.mockRejectedValue(new Error('offline'));
    useNotificationsStore.getState().markAllRead();
    expect(useNotificationsStore.getState().unread()).toBe(0); // optimistic

    await flush();
    // Only n1 (the one that WAS unread) rolls back; n2 stays read.
    expect(read('n1')).toBe(false);
    expect(read('n2')).toBe(true);
    expect(useNotificationsStore.getState().unread()).toBe(1);
  });
});
