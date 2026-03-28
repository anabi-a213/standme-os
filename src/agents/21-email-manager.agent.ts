import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import {
  searchEmailsByQuery,
  getEmailsByLabel,
  sendEmail,
  EmailMessage,
} from '../services/google/gmail';
import { sendToMo, formatType2 } from '../services/telegram/bot';
import { logger } from '../utils/logger';

// ─── Session store ──────────────────────────────────────────────────────────
// Stores the last /inbox or /searchmail result per chatId so the user can
// reference emails by number in /readmail and /replymail.
// TTL: 30 minutes — after that the list is stale and should be refreshed.

interface EmailSession {
  emails: EmailMessage[];
  fetchedAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const emailSessions = new Map<number, EmailSession>();

function saveSession(chatId: number, emails: EmailMessage[]): void {
  emailSessions.set(chatId, { emails, fetchedAt: Date.now() });
}

function getSession(chatId: number): EmailMessage[] | null {
  const session = emailSessions.get(chatId);
  if (!session) return null;
  if (Date.now() - session.fetchedAt > SESSION_TTL_MS) {
    emailSessions.delete(chatId);
    return null;
  }
  return session.emails;
}

// Purge stale sessions hourly
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of emailSessions) {
    if (s.fetchedAt < cutoff) emailSessions.delete(id);
  }
}, 60 * 60 * 1000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Truncate a string to maxLen chars, adding … if cut */
function trunc(s: string, maxLen: number): string {
  s = (s || '').replace(/\r?\n/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

/** Extract first name from "First Last <email>" or just return the email */
function shortSender(from: string): string {
  const match = from.match(/^([^<"]+)/);
  const name = (match?.[1] || from).trim().replace(/"/g, '');
  return name || from;
}

/** Format a date string to something compact */
function shortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  } catch {
    return dateStr.slice(0, 10);
  }
}

/** Render a numbered inbox list as Telegram Markdown */
function formatEmailList(emails: EmailMessage[], title: string): string {
  if (!emails.length) return `${title}\n\nNo emails found.`;
  const lines = emails.map((e, i) =>
    `*${i + 1}.* ${trunc(shortSender(e.from), 22)} — ${trunc(e.subject || '(no subject)', 40)}\n` +
    `     _${shortDate(e.date)}_`
  );
  return `${title}\n\n${lines.join('\n\n')}\n\n` +
    `Reply with:\n` +
    `/readmail [number] — read full email\n` +
    `/replymail [number] [your message] — reply in thread`;
}

/** Render a full email for reading */
function formatFullEmail(index: number, email: EmailMessage): string {
  const body = (email.body || '(empty)').slice(0, 2800);
  return (
    `*Email #${index}*\n` +
    `*From:* ${email.from}\n` +
    `*To:* ${email.to}\n` +
    `*Subject:* ${email.subject || '(no subject)'}\n` +
    `*Date:* ${email.date}\n` +
    `───────────────\n` +
    `${body}` +
    (email.body && email.body.length > 2800 ? '\n\n_[truncated — email is longer]_' : '') +
    `\n───────────────\n` +
    `To reply: /replymail ${index} [your message]`
  );
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class EmailManagerAgent extends BaseAgent {
  config: AgentConfig = {
    id:           'agent-21',
    name:         'Email Manager',
    commands:     ['/inbox', '/readmail', '/replymail', '/sendmail', '/searchmail'],
    requiredRole: UserRole.ADMIN,
    description:  'Read, search, reply to, and send emails via Gmail from Telegram',
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const cmd  = ctx.command.toLowerCase();
    const args = (ctx.args || '').trim();

    // ── /inbox ─────────────────────────────────────────────────────────────
    if (cmd === '/inbox') {
      await this.respond(ctx.chatId, '_Fetching inbox..._');
      try {
        // Unread emails first, then fall back to recent inbox
        let emails = await searchEmailsByQuery('in:inbox is:unread', 10);
        if (emails.length < 3) {
          // supplement with recent read emails
          const recent = await searchEmailsByQuery('in:inbox', 10);
          const seen = new Set(emails.map(e => e.id));
          for (const e of recent) {
            if (!seen.has(e.id)) emails.push(e);
            if (emails.length >= 10) break;
          }
        }
        emails = emails.slice(0, 10);
        saveSession(ctx.chatId, emails);

        const unreadCount = emails.filter(e => e.labels.includes('UNREAD')).length;
        const title = `*Inbox* — ${emails.length} emails${unreadCount ? ` (${unreadCount} unread)` : ''}`;
        await this.respond(ctx.chatId, formatEmailList(emails, title));
        return { success: true, message: `Inbox fetched: ${emails.length} emails`, confidence: 'HIGH' };
      } catch (err: any) {
        logger.error(`[EmailManager] /inbox error: ${err.message}`);
        await this.respond(ctx.chatId, `Failed to fetch inbox: ${err.message}`);
        return { success: false, message: err.message, confidence: 'LOW' };
      }
    }

    // ── /searchmail ────────────────────────────────────────────────────────
    if (cmd === '/searchmail') {
      if (!args) {
        await this.respond(ctx.chatId,
          'Usage: `/searchmail [query]`\n\nExamples:\n' +
          '`/searchmail Arab Health`\n' +
          '`/searchmail from:client@company.com`\n' +
          '`/searchmail subject:proposal`');
        return { success: false, message: 'No query', confidence: 'LOW' };
      }
      await this.respond(ctx.chatId, `_Searching: "${args}"..._`);
      try {
        const emails = await searchEmailsByQuery(args, 10);
        saveSession(ctx.chatId, emails);
        const title = `*Search:* "${args}" — ${emails.length} result${emails.length !== 1 ? 's' : ''}`;
        await this.respond(ctx.chatId, formatEmailList(emails, title));
        return { success: true, message: `Search returned ${emails.length} emails`, confidence: 'HIGH' };
      } catch (err: any) {
        logger.error(`[EmailManager] /searchmail error: ${err.message}`);
        await this.respond(ctx.chatId, `Search failed: ${err.message}`);
        return { success: false, message: err.message, confidence: 'LOW' };
      }
    }

    // ── /readmail [number] ─────────────────────────────────────────────────
    if (cmd === '/readmail') {
      const index = parseInt(args);
      if (!args || isNaN(index) || index < 1) {
        await this.respond(ctx.chatId,
          'Usage: `/readmail [number]`\n\nRun /inbox first, then use the email number.');
        return { success: false, message: 'Invalid index', confidence: 'LOW' };
      }
      const session = getSession(ctx.chatId);
      if (!session) {
        await this.respond(ctx.chatId,
          'No email list in memory. Run /inbox or /searchmail first.'
        );
        return { success: false, message: 'No session', confidence: 'LOW' };
      }
      const email = session[index - 1];
      if (!email) {
        await this.respond(ctx.chatId,
          `No email #${index}. The list has ${session.length} emails. Run /inbox to refresh.`
        );
        return { success: false, message: 'Index out of range', confidence: 'LOW' };
      }
      await this.respond(ctx.chatId, formatFullEmail(index, email));
      return { success: true, message: `Read email #${index}`, confidence: 'HIGH' };
    }

    // ── /replymail [number] [message] ──────────────────────────────────────
    if (cmd === '/replymail') {
      const spaceIdx = args.indexOf(' ');
      const indexStr = spaceIdx > -1 ? args.slice(0, spaceIdx) : args;
      const replyBody = spaceIdx > -1 ? args.slice(spaceIdx + 1).trim() : '';
      const index = parseInt(indexStr);

      if (!args || isNaN(index) || index < 1 || !replyBody) {
        await this.respond(ctx.chatId,
          'Usage: `/replymail [number] [your message]`\n\n' +
          'Example: `/replymail 3 Thanks for reaching out! We will send a proposal by Friday.`');
        return { success: false, message: 'Invalid args', confidence: 'LOW' };
      }

      const session = getSession(ctx.chatId);
      if (!session) {
        await this.respond(ctx.chatId,
          'No email list in memory. Run /inbox or /searchmail first, then /replymail.'
        );
        return { success: false, message: 'No session', confidence: 'LOW' };
      }
      const original = session[index - 1];
      if (!original) {
        await this.respond(ctx.chatId,
          `No email #${index}. The list has ${session.length} emails.`
        );
        return { success: false, message: 'Index out of range', confidence: 'LOW' };
      }

      // Extract reply-to address from "Name <email>" or bare email
      const toMatch = original.from.match(/<([^>]+)>/);
      const toAddress = toMatch ? toMatch[1] : original.from.trim();
      const reSubject = original.subject.startsWith('Re:')
        ? original.subject
        : `Re: ${original.subject}`;

      await this.respond(ctx.chatId, `_Sending reply to ${toAddress}..._`);

      try {
        await sendEmail(
          toAddress,
          reSubject,
          replyBody,
          original.id,          // In-Reply-To: keeps it in the same Gmail thread
          original.messageId,   // References header
        );
        await this.respond(ctx.chatId,
          `*Reply sent* to ${toAddress}\n*Subject:* ${reSubject}\n\n${trunc(replyBody, 300)}`);
        return { success: true, message: `Reply sent to ${toAddress}`, confidence: 'HIGH' };
      } catch (err: any) {
        logger.error(`[EmailManager] /replymail error: ${err.message}`);
        await this.respond(ctx.chatId, `Failed to send reply: ${err.message}`);
        return { success: false, message: err.message, confidence: 'LOW' };
      }
    }

    // ── /sendmail [to] | [subject] | [body] ────────────────────────────────
    if (cmd === '/sendmail') {
      if (!args || !args.includes('|')) {
        await this.respond(ctx.chatId,
          '*Usage:* `/sendmail [to] | [subject] | [body]`\n\n' +
          '*Example:*\n' +
          '`/sendmail client@pharma.com | Proposal for Arab Health 2025 | Hi Ahmed, following up on our conversation. Please find our initial concept attached.`');
        return { success: false, message: 'Invalid format', confidence: 'LOW' };
      }

      const parts = args.split('|').map(p => p.trim());
      if (parts.length < 3) {
        await this.respond(ctx.chatId,
          'Need three parts separated by `|`: *to address* | *subject* | *body*');
        return { success: false, message: 'Missing parts', confidence: 'LOW' };
      }

      const [to, subject, ...bodyParts] = parts;
      const body = bodyParts.join(' | '); // allow | in body

      if (!to.includes('@')) {
        await this.respond(ctx.chatId, `"${to}" doesn't look like a valid email address.`);
        return { success: false, message: 'Invalid to address', confidence: 'LOW' };
      }

      await this.respond(ctx.chatId,
        `_Sending email to ${to}..._`);

      try {
        await sendEmail(to, subject, body);
        await this.respond(ctx.chatId,
          `*Email sent*\n*To:* ${to}\n*Subject:* ${subject}\n\n${trunc(body, 300)}`);
        return { success: true, message: `Email sent to ${to}`, confidence: 'HIGH' };
      } catch (err: any) {
        logger.error(`[EmailManager] /sendmail error: ${err.message}`);
        await this.respond(ctx.chatId, `Failed to send email: ${err.message}`);
        return { success: false, message: err.message, confidence: 'LOW' };
      }
    }

    return { success: false, message: `Unknown command: ${cmd}`, confidence: 'LOW' };
  }
}
