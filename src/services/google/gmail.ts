import { google, gmail_v1 } from 'googleapis';
import { getGoogleAuth } from './auth';
import { retry } from '../../utils/retry';

let _gmail: gmail_v1.Gmail | null = null;

function getGmailClient(): gmail_v1.Gmail {
  if (!_gmail) {
    _gmail = google.gmail({ version: 'v1', auth: getGoogleAuth() });
  }
  return _gmail;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  labels: string[];
  /** RFC 2822 Message-ID header — used for In-Reply-To / References threading */
  messageId?: string;
  /** Present when message was retrieved with internalDate */
  internalDate?: string;
}

/**
 * Recursively extract plain-text body from a Gmail message payload.
 * Handles:
 *   - Simple messages (payload.body.data)
 *   - multipart/alternative  (text/plain + text/html at top level)
 *   - multipart/mixed → multipart/alternative → text/plain (deeply nested)
 *   - HTML-only fallback (strip tags)
 */
function extractBodyFromPayload(payload: gmail_v1.Schema$MessagePart | undefined | null): string {
  if (!payload) return '';

  // Leaf node with data
  if (payload.body?.data && payload.mimeType !== 'multipart/alternative' && payload.mimeType !== 'multipart/mixed') {
    const text = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    if (payload.mimeType === 'text/html') {
      // Strip HTML tags as a fallback plain-text representation
      return text.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }
    return text;
  }

  if (!payload.parts?.length) return '';

  // Prefer text/plain recursively
  for (const part of payload.parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }

  // Recurse into sub-parts (multipart/mixed, multipart/related, etc.)
  for (const part of payload.parts) {
    const text = extractBodyFromPayload(part);
    if (text) return text;
  }

  return '';
}

/**
 * Build a full EmailMessage from a raw Gmail message object.
 * Centralises header parsing + body extraction so it's consistent everywhere.
 */
function parseGmailMessage(full: gmail_v1.Schema$Message): EmailMessage {
  const headers = full.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

  return {
    id: full.id || '',
    threadId: full.threadId || '',
    from: getHeader('From'),
    to: getHeader('To'),
    subject: getHeader('Subject'),
    body: extractBodyFromPayload(full.payload),
    date: getHeader('Date'),
    labels: full.labelIds || [],
    messageId: getHeader('Message-ID') || getHeader('Message-Id') || undefined,
    internalDate: full.internalDate || undefined,
  };
}

/** Fetch one full message and parse it */
async function fetchAndParse(msgId: string): Promise<EmailMessage | null> {
  try {
    const full = await getGmailClient().users.messages.get({
      userId: 'me',
      id: msgId,
      format: 'full',
    });
    return parseGmailMessage(full.data);
  } catch {
    return null;
  }
}

export async function getEmailsByLabel(label: string, maxResults = 20): Promise<EmailMessage[]> {
  return retry(async () => {
    // First find the label ID
    const labelsResp = await getGmailClient().users.labels.list({ userId: 'me' });
    const labelObj = labelsResp.data.labels?.find(l => l.name === label);
    if (!labelObj) return [];

    const response = await getGmailClient().users.messages.list({
      userId: 'me',
      labelIds: [labelObj.id!],
      maxResults,
    });

    if (!response.data.messages) return [];

    const emails: EmailMessage[] = [];
    for (const msg of response.data.messages) {
      const parsed = await fetchAndParse(msg.id!);
      if (parsed) emails.push(parsed);
    }
    return emails;
  }, 'getEmailsByLabel');
}

/**
 * Send an email, optionally as a reply to an existing thread.
 * @param inReplyToMessageId - Gmail message ID of the email being replied to (for thread linking)
 * @param references          - space-separated Message-IDs for the References header
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  inReplyToMessageId?: string,
  references?: string,
): Promise<string> {
  return retry(async () => {
    const fromEmail = process.env.SEND_FROM_EMAIL || 'info@standme.de';

    // Build headers — include threading headers if this is a reply
    const headerLines = [
      `From: ${fromEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset=utf-8`,
    ];
    if (inReplyToMessageId) headerLines.push(`In-Reply-To: ${inReplyToMessageId}`);
    if (references) headerLines.push(`References: ${references}`);

    const raw = Buffer.from(
      `${headerLines.join('\r\n')}\r\n\r\n${body}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const requestBody: gmail_v1.Schema$Message = { raw };
    // If replying to a known thread, keep it in the same thread
    if (inReplyToMessageId) {
      const origMsg = await getGmailClient().users.messages.get({
        userId: 'me', id: inReplyToMessageId, format: 'minimal',
      }).catch(() => null);
      if (origMsg?.data?.threadId) requestBody.threadId = origMsg.data.threadId;
    }

    const response = await getGmailClient().users.messages.send({
      userId: 'me',
      requestBody,
    });
    return response.data.id || '';
  }, 'sendEmail');
}

export async function searchEmailsByQuery(query: string, maxResults = 20): Promise<EmailMessage[]> {
  return retry(async () => {
    const response = await getGmailClient().users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    if (!response.data.messages) return [];

    const emails: EmailMessage[] = [];
    for (const msg of response.data.messages) {
      const parsed = await fetchAndParse(msg.id!);
      if (parsed) emails.push(parsed);
    }
    return emails;
  }, 'searchEmailsByQuery');
}

/**
 * Bulk-read all Gmail messages matching a query, fetching in batches.
 * Used by /indexgmail to scan large volumes of inbox/sent mail efficiently.
 * Returns messages with body text — skips auto-generated / no-reply senders.
 */
export async function bulkSearchEmails(
  query: string,
  maxTotal = 200,
): Promise<EmailMessage[]> {
  const gmail = getGmailClient();
  const results: EmailMessage[] = [];
  let pageToken: string | undefined;

  while (results.length < maxTotal) {
    const batchSize = Math.min(50, maxTotal - results.length);
    const listResp = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: batchSize,
      pageToken,
    }).catch(() => null);

    if (!listResp?.data.messages?.length) break;

    // Fetch full message details in parallel (max 10 at a time to avoid rate limits)
    const ids = listResp.data.messages.map(m => m.id!).filter(Boolean);
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const parsed = await Promise.all(batch.map(id => fetchAndParse(id)));
      for (const msg of parsed) {
        if (msg && msg.body.length > 30) results.push(msg); // skip empty bodies
      }
    }

    pageToken = listResp.data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  return results;
}

export async function createDraft(to: string, subject: string, body: string): Promise<string> {
  return retry(async () => {
    const fromEmail = process.env.SEND_FROM_EMAIL || 'info@standme.de';
    const raw = Buffer.from(
      `From: ${fromEmail}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const response = await getGmailClient().users.drafts.create({
      userId: 'me',
      requestBody: {
        message: { raw },
      },
    });
    return response.data.id || '';
  }, 'createDraft');
}
