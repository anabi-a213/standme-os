import TelegramBot from 'node-telegram-bot-api';
import { getUserRole, UserRole } from '../../config/access';
import { detectLanguage } from '../ai/client';
import { AgentContext } from '../../types/agent';
import { logger } from '../../utils/logger';

let _bot: TelegramBot | null = null;

export function getBot(): TelegramBot {
  if (!_bot) {
    _bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || '', { polling: true });
  }
  return _bot;
}

export function initBot(): TelegramBot {
  const bot = getBot();

  bot.on('polling_error', (error) => {
    logger.error(`Telegram polling error: ${error.message}`);
  });

  logger.info('Telegram bot initialized and polling');
  return bot;
}

// Format messages according to the 3 types
export function formatType1(what: string, why: string, detail: string, approveId: string): string {
  return `⚡ *ACTION NEEDED*\n\n*What:* ${what}\n*Why:* ${why}\n\n${detail}\n\n/approve\\_${approveId} | /reject\\_${approveId}`;
}

export function formatType2(topic: string, detail: string): string {
  return `⚠️ *HEADS UP*\n\n*${topic}*\n\n${detail}`;
}

export function formatType3(title: string, sections: { label: string; content: string }[]): string {
  let msg = `📊 *${title}*\n`;
  for (const section of sections) {
    msg += `\n*${section.label}:*\n${section.content}\n`;
  }
  return msg;
}

// Send to Mo (admin)
export async function sendToMo(message: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<void> {
  const bot = getBot();
  const moId = process.env.MO_TELEGRAM_ID || '6140480367';
  try {
    await bot.sendMessage(parseInt(moId), message, { parse_mode: parseMode });
  } catch (err: any) {
    logger.error(`Failed to send to Mo: ${err.message}`);
  }
}

// Send to multiple team members
export async function sendToTeam(message: string, userIds: string[]): Promise<void> {
  const bot = getBot();
  for (const id of userIds) {
    try {
      await bot.sendMessage(parseInt(id), message, { parse_mode: 'Markdown' });
    } catch (err: any) {
      logger.error(`Failed to send to ${id}: ${err.message}`);
    }
  }
}

// Build agent context from a Telegram message
export async function buildContext(msg: TelegramBot.Message): Promise<AgentContext | null> {
  if (!msg.text || !msg.from) return null;

  const userId = msg.from.id.toString();
  const username = msg.from.username || '';
  const { role } = getUserRole(userId, username);

  // Block unregistered users
  if (role === UserRole.UNREGISTERED) {
    const bot = getBot();
    await bot.sendMessage(msg.chat.id, 'This is a private system. Contact Mo.');
    return null;
  }

  const text = msg.text.trim();
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  const language = await detectLanguage(text);

  return {
    userId,
    username,
    chatId: msg.chat.id,
    command,
    args,
    role,
    language,
  };
}
