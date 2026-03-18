import { UserRole } from '../config/access';
import { ConfidenceLevel } from './confidence';

export interface AgentConfig {
  name: string;
  id: string;
  description: string;
  commands: string[];
  schedule?: string; // cron expression
  requiredRole: UserRole;
}

export interface AgentContext {
  userId: string;
  username?: string;
  chatId: number;
  command: string;
  args: string;
  role: UserRole;
  language: 'ar' | 'en' | 'franco';
  /** Recent cross-agent activity for this user — injected automatically by BaseAgent.run() */
  threadContext?: string;
  /** What entity (lead/project/show/contractor) the user is currently focused on */
  activeFocus?: { type: string; name: string };
}

export interface AgentResponse {
  success: boolean;
  message: string;
  confidence: ConfidenceLevel;
  data?: Record<string, unknown>;
}

export type MessageType = 'TYPE1_ACTION' | 'TYPE2_ALERT' | 'TYPE3_SUMMARY';
