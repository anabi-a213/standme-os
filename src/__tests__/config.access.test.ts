/**
 * Unit tests for src/config/access.ts
 * Tests role lookups, permission checks, and team member structure.
 */
import {
  UserRole,
  getTeamMembers,
  getUserRole,
  canApprove,
  canChangeSettings,
  TeamMember,
} from '../config/access';

describe('UserRole enum', () => {
  it('has ADMIN value', () => {
    expect(UserRole.ADMIN).toBe('ADMIN');
  });

  it('has SUB_ADMIN value', () => {
    expect(UserRole.SUB_ADMIN).toBe('SUB_ADMIN');
  });

  it('has OPS_LEAD value', () => {
    expect(UserRole.OPS_LEAD).toBe('OPS_LEAD');
  });

  it('has UNREGISTERED value', () => {
    expect(UserRole.UNREGISTERED).toBe('UNREGISTERED');
  });
});

describe('getTeamMembers', () => {
  it('returns an array with at least 4 members', () => {
    const members = getTeamMembers();
    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBeGreaterThanOrEqual(4);
  });

  it('includes Mo as ADMIN with canApprove and canChangeAgentSettings', () => {
    const mo = getTeamMembers().find(m => m.name === 'Mo');
    expect(mo).toBeDefined();
    expect(mo!.role).toBe(UserRole.ADMIN);
    expect(mo!.canApprove).toBe(true);
    expect(mo!.canChangeAgentSettings).toBe(true);
  });

  it('includes Bassel as SUB_ADMIN with canApprove but not canChangeAgentSettings', () => {
    const bassel = getTeamMembers().find(m => m.name === 'Bassel');
    expect(bassel).toBeDefined();
    expect(bassel!.role).toBe(UserRole.SUB_ADMIN);
    expect(bassel!.canApprove).toBe(true);
    expect(bassel!.canChangeAgentSettings).toBe(false);
  });

  it('includes Hadeer as OPS_LEAD without canApprove or canChangeAgentSettings', () => {
    const hadeer = getTeamMembers().find(m => m.name === 'Hadeer');
    expect(hadeer).toBeDefined();
    expect(hadeer!.role).toBe(UserRole.OPS_LEAD);
    expect(hadeer!.canApprove).toBe(false);
    expect(hadeer!.canChangeAgentSettings).toBe(false);
  });

  it('Mo has a non-empty telegramId', () => {
    const mo = getTeamMembers().find(m => m.name === 'Mo');
    expect(mo!.telegramId).toBeTruthy();
  });
});

describe('getUserRole', () => {
  beforeEach(() => {
    // Reset env to known defaults for deterministic tests
    delete process.env.MO_TELEGRAM_ID;
    delete process.env.MO_BACKUP_TELEGRAM_ID;
    delete process.env.HADEER_TELEGRAM_ID;
    delete process.env.BASSEL_TELEGRAM_USERNAME;
  });

  it('returns ADMIN for Mo\'s default telegram ID', () => {
    const { role, member } = getUserRole('6140480367');
    expect(role).toBe(UserRole.ADMIN);
    expect(member).not.toBeNull();
    expect(member!.name).toBe('Mo');
  });

  it('returns ADMIN for Mo\'s backup telegram ID', () => {
    const { role, member } = getUserRole('517107884');
    expect(role).toBe(UserRole.ADMIN);
    expect(member).not.toBeNull();
  });

  it('returns OPS_LEAD for Hadeer\'s default telegram ID', () => {
    const { role, member } = getUserRole('5135842073');
    expect(role).toBe(UserRole.OPS_LEAD);
    expect(member!.name).toBe('Hadeer');
  });

  it('returns UNREGISTERED for unknown telegram ID', () => {
    const { role, member } = getUserRole('9999999999');
    expect(role).toBe(UserRole.UNREGISTERED);
    expect(member).toBeNull();
  });

  it('returns UNREGISTERED for empty telegram ID with no username match', () => {
    const { role } = getUserRole('', 'some_random_user');
    expect(role).toBe(UserRole.UNREGISTERED);
  });

  it('returns SUB_ADMIN for Bassel matched by default username', () => {
    const { role, member } = getUserRole('111222333', 'bassel_al_hussein');
    expect(role).toBe(UserRole.SUB_ADMIN);
    expect(member).not.toBeNull();
    expect(member!.name).toBe('Bassel');
  });

  it('does NOT persist Bassel\'s telegram ID across calls (getTeamMembers returns a new array each time)', () => {
    // Current behavior: getUserRole calls getTeamMembers() which returns a fresh array.
    // Mutating bassel.telegramId on that array does not affect future calls.
    // Second lookup by ID alone therefore returns UNREGISTERED.
    const newId = '444555666';
    getUserRole(newId, 'bassel_al_hussein'); // sets bassel.telegramId on the ephemeral array
    const { role } = getUserRole(newId);    // fresh array — ID not saved
    expect(role).toBe(UserRole.UNREGISTERED);
  });
});

describe('canApprove', () => {
  it('returns true for ADMIN', () => {
    expect(canApprove(UserRole.ADMIN)).toBe(true);
  });

  it('returns true for SUB_ADMIN', () => {
    expect(canApprove(UserRole.SUB_ADMIN)).toBe(true);
  });

  it('returns false for OPS_LEAD', () => {
    expect(canApprove(UserRole.OPS_LEAD)).toBe(false);
  });

  it('returns false for UNREGISTERED', () => {
    expect(canApprove(UserRole.UNREGISTERED)).toBe(false);
  });
});

describe('canChangeSettings', () => {
  it('returns true only for ADMIN', () => {
    expect(canChangeSettings(UserRole.ADMIN)).toBe(true);
    expect(canChangeSettings(UserRole.SUB_ADMIN)).toBe(false);
    expect(canChangeSettings(UserRole.OPS_LEAD)).toBe(false);
    expect(canChangeSettings(UserRole.UNREGISTERED)).toBe(false);
  });
});
