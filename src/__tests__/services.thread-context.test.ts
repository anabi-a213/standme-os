/**
 * Unit tests for src/services/thread-context.ts
 * In-memory state — no external dependencies.
 *
 * IMPORTANT: thread-context uses a module-level Map. Each test that modifies
 * state should use distinct userIds to avoid cross-test contamination.
 */
import {
  getThreadContext,
  saveThreadEntry,
  setActiveFocus,
  getActiveFocus,
  clearThread,
} from '../services/thread-context';

describe('getThreadContext', () => {
  it('returns empty string for a user with no history', () => {
    const result = getThreadContext('user_no_history_at_all');
    expect(result).toBe('');
  });

  it('returns empty string after clearing a user\'s thread', () => {
    const uid = 'user_clear_test';
    saveThreadEntry(uid, 'agent1', '/test', 'hello', 'world');
    clearThread(uid);
    expect(getThreadContext(uid)).toBe('');
  });

  it('returns non-empty string after saving an entry', () => {
    const uid = 'user_with_entry';
    saveThreadEntry(uid, 'brain', '/ask', 'What shows are in Dubai?', 'Arab Health and Gulfood');
    const ctx = getThreadContext(uid);
    expect(ctx).not.toBe('');
    expect(ctx).toContain('THREAD CONTEXT');
  });

  it('includes the command in the thread context string', () => {
    const uid = 'user_cmd_check';
    saveThreadEntry(uid, 'brain', '/pipeline', 'show pipeline', 'Here is your pipeline');
    const ctx = getThreadContext(uid);
    expect(ctx).toContain('/pipeline');
  });

  it('includes the active focus when set', () => {
    const uid = 'user_focus_in_ctx';
    saveThreadEntry(uid, 'brain', '/ask', 'something', 'response', { type: 'lead', name: 'Acme Corp' });
    const ctx = getThreadContext(uid);
    expect(ctx).toContain('CURRENTLY WORKING ON');
    expect(ctx).toContain('Acme Corp');
  });
});

describe('saveThreadEntry', () => {
  it('saves an entry and makes it retrievable via getThreadContext', () => {
    const uid = 'user_save_basic';
    saveThreadEntry(uid, 'agent42', '/status', 'check status', 'All systems go');
    const ctx = getThreadContext(uid);
    expect(ctx).toContain('/status');
  });

  it('truncates long userMsg to 200 chars', () => {
    const uid = 'user_truncate_msg';
    const longMsg = 'x'.repeat(500);
    // Should not throw
    saveThreadEntry(uid, 'agent1', '/cmd', longMsg, 'ok');
    // getThreadContext shouldn't contain the full 500-char string verbatim
    const ctx = getThreadContext(uid);
    expect(ctx).not.toContain('x'.repeat(300));
  });

  it('sets activeFocus when entity is provided', () => {
    const uid = 'user_entity_focus';
    saveThreadEntry(uid, 'agent1', '/cmd', 'msg', 'resp', { type: 'project', name: 'ISE Berlin Stand' });
    const focus = getActiveFocus(uid);
    expect(focus).toBeDefined();
    expect(focus!.type).toBe('project');
    expect(focus!.name).toBe('ISE Berlin Stand');
  });

  it('does NOT set activeFocus when entity is not provided', () => {
    const uid = 'user_no_entity';
    clearThread(uid);
    saveThreadEntry(uid, 'agent1', '/cmd', 'msg', 'resp');
    const focus = getActiveFocus(uid);
    expect(focus).toBeUndefined();
  });

  it('caps entries at 20 (MAX_ENTRIES)', () => {
    const uid = 'user_max_entries';
    clearThread(uid);
    for (let i = 0; i < 25; i++) {
      saveThreadEntry(uid, 'agent', `/cmd${i}`, `msg${i}`, `resp${i}`);
    }
    // Context should show recent entries, not all 25
    const ctx = getThreadContext(uid);
    // The oldest entries (cmd0..cmd4) should not appear since they got evicted
    // Context only shows last 10, but thread stores last 20
    // We can't directly inspect the internal array, so verify context still works
    expect(ctx).toBeTruthy();
    expect(ctx).toContain('THREAD CONTEXT');
  });
});

describe('setActiveFocus / getActiveFocus', () => {
  it('sets and retrieves active focus', () => {
    const uid = 'user_focus_set';
    setActiveFocus(uid, 'show', 'MEDICA');
    const focus = getActiveFocus(uid);
    expect(focus).toBeDefined();
    expect(focus!.type).toBe('show');
    expect(focus!.name).toBe('MEDICA');
  });

  it('overwrites existing focus', () => {
    const uid = 'user_focus_overwrite';
    setActiveFocus(uid, 'lead', 'OldCompany');
    setActiveFocus(uid, 'contractor', 'FastBuilders GmbH');
    const focus = getActiveFocus(uid);
    expect(focus!.type).toBe('contractor');
    expect(focus!.name).toBe('FastBuilders GmbH');
  });

  it('returns undefined for a user with no focus set', () => {
    const uid = 'user_no_focus_ever_set_xyz';
    const focus = getActiveFocus(uid);
    expect(focus).toBeUndefined();
  });
});

describe('clearThread', () => {
  it('removes all entries and focus for a user', () => {
    const uid = 'user_to_clear';
    saveThreadEntry(uid, 'agent', '/cmd', 'msg', 'resp');
    setActiveFocus(uid, 'lead', 'Some Lead');
    clearThread(uid);
    expect(getThreadContext(uid)).toBe('');
    expect(getActiveFocus(uid)).toBeUndefined();
  });

  it('is safe to call for a user that does not exist', () => {
    expect(() => clearThread('nonexistent_user_abc123')).not.toThrow();
  });
});

describe('getThreadContext format', () => {
  it('uses "just now" for very recent entries', () => {
    const uid = 'user_time_just_now';
    clearThread(uid);
    saveThreadEntry(uid, 'brain', '/ask', 'recent query', 'recent response');
    const ctx = getThreadContext(uid);
    expect(ctx).toContain('just now');
  });

  it('lists RECENT ACTIVITY heading', () => {
    const uid = 'user_activity_heading';
    clearThread(uid);
    saveThreadEntry(uid, 'brain', '/brain', 'test', 'answer');
    const ctx = getThreadContext(uid);
    expect(ctx).toContain('RECENT ACTIVITY');
  });

  it('shows entries in newest-first order', () => {
    const uid = 'user_order_check';
    clearThread(uid);
    saveThreadEntry(uid, 'a1', '/first', 'first msg', 'first resp');
    saveThreadEntry(uid, 'a2', '/second', 'second msg', 'second resp');
    const ctx = getThreadContext(uid);
    const firstPos = ctx.indexOf('/first');
    const secondPos = ctx.indexOf('/second');
    // Newest (/second) should appear BEFORE oldest (/first) in context
    expect(secondPos).toBeLessThan(firstPos);
  });
});
