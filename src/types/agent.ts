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
}

export interface AgentResponse {
  success: boolean;
  message: string;
  confidence: ConfidenceLevel;
  data?: Record<string, unknown>;
}

export type MessageType = 'TYPE1_ACTION' | 'TYPE2_ALERT' | 'TYPE3_SUMMARY';
