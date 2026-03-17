export enum UserRole {
  ADMIN = 'ADMIN',
  SUB_ADMIN = 'SUB_ADMIN',
  OPS_LEAD = 'OPS_LEAD',
  UNREGISTERED = 'UNREGISTERED',
}

export interface TeamMember {
  name: string;
  role: UserRole;
  telegramId: string;
  canApprove: boolean;
  canChangeAgentSettings: boolean;
}

export function getTeamMembers(): TeamMember[] {
  return [
    {
      name: 'Mo',
      role: UserRole.ADMIN,
      telegramId: process.env.MO_TELEGRAM_ID || '6140480367',
      canApprove: true,
      canChangeAgentSettings: true,
    },
    {
      name: 'Mo (Backup)',
      role: UserRole.ADMIN,
      telegramId: process.env.MO_BACKUP_TELEGRAM_ID || '517107884',
      canApprove: true,
      canChangeAgentSettings: true,
    },
    {
      name: 'Bassel',
      role: UserRole.SUB_ADMIN,
      telegramId: '', // captured on first message via username
      canApprove: true,
      canChangeAgentSettings: false,
    },
    {
      name: 'Hadeer',
      role: UserRole.OPS_LEAD,
      telegramId: process.env.HADEER_TELEGRAM_ID || '5135842073',
      canApprove: false,
      canChangeAgentSettings: false,
    },
  ];
}

export function getUserRole(telegramId: string, username?: string): { role: UserRole; member: TeamMember | null } {
  const members = getTeamMembers();

  for (const member of members) {
    if (member.telegramId && member.telegramId === telegramId) {
      return { role: member.role, member };
    }
  }

  // Check Bassel by username
  const basselUsername = process.env.BASSEL_TELEGRAM_USERNAME || 'bassel_al_hussein';
  if (username && username === basselUsername) {
    const bassel = members.find(m => m.name === 'Bassel')!;
    // Save Bassel's telegram ID for future lookups
    bassel.telegramId = telegramId;
    return { role: UserRole.SUB_ADMIN, member: bassel };
  }

  return { role: UserRole.UNREGISTERED, member: null };
}

export function canApprove(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUB_ADMIN;
}

export function canChangeSettings(role: UserRole): boolean {
  return role === UserRole.ADMIN;
}
