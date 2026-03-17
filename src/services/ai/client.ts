import Anthropic from '@anthropic-ai/sdk';
import { retry } from '../../utils/retry';

let _client: Anthropic | null = null;

function getAIClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function generateText(prompt: string, systemPrompt?: string, maxTokens = 2000): Promise<string> {
  return retry(async () => {
    const response = await getAIClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 30000 });

    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }, 'generateText');
}

export async function classifyIntent(message: string): Promise<string> {
  const intents = [
    'status_check', 'lead_query', 'project_query', 'deadline_query',
    'contractor_query', 'file_search', 'outreach_query', 'lessons_query',
    'show_validation', 'approval_action', 'rejection_action', 'marketing_request',
    'analytics_request', 'reconciliation', 'team_management', 'content_request',
    'drive_search', 'cross_board_check', 'general_query',
  ];

  const result = await generateText(
    `Classify this message into exactly one intent category.\n\nMessage: "${message}"\n\nCategories: ${intents.join(', ')}\n\nRespond with ONLY the category name, nothing else.`,
    'You are an intent classifier for a business operating system. Respond with only the category name.',
    50
  );

  const cleaned = result.trim().toLowerCase();
  return intents.includes(cleaned) ? cleaned : 'general_query';
}

export async function detectLanguage(text: string): Promise<'ar' | 'en' | 'franco'> {
  // Simple heuristic: check for Arabic characters
  const arabicRegex = /[\u0600-\u06FF]/;
  const francoRegex = /[23456789]+[a-zA-Z]+|[a-zA-Z]+[23456789]+/;

  if (arabicRegex.test(text)) return 'ar';
  if (francoRegex.test(text)) return 'franco';
  return 'en';
}

export async function generateBrief(context: {
  clientName: string;
  showName: string;
  showCity: string;
  standSize: string;
  budget: string;
  industry: string;
  brandGuidelines?: string;
  lessonsLearned?: string;
}): Promise<string> {
  const prompt = `Generate a concept brief for an exhibition stand. Details:
- Client: ${context.clientName}
- Show: ${context.showName} (${context.showCity})
- Stand Size: ${context.standSize} sqm
- Budget: ${context.budget}
- Industry: ${context.industry}
${context.brandGuidelines ? `- Brand Guidelines: ${context.brandGuidelines}` : ''}
${context.lessonsLearned ? `- Previous Lessons: ${context.lessonsLearned}` : ''}

Structure (500-700 words, NO filler):
1. Client + show context
2. 3 concept directions with rationale
3. AI image prompts for each direction (ready for Midjourney)
4. Key constraints (size, budget, brand)
5. Recommended next step

Write in a confident, practical tone. No generic filler.`;

  return generateText(prompt, 'You are a senior exhibition stand designer at StandMe. Write concise, actionable concept briefs.', 3000);
}

export async function generateOutreachEmail(context: {
  companyName: string;
  contactName: string;
  showName: string;
  industry: string;
  standSize?: string;
  emailNumber: number; // 1, 2, or 3 in sequence
}): Promise<{ subject: string; body: string }> {
  const emailTypes: Record<number, string> = {
    1: 'First outreach email - direct hook specific to their company/show',
    2: 'Follow-up email - different angle, NOT "just checking in"',
    3: 'Final touch - short, easy to reply, low pressure',
  };

  const prompt = `Write an outreach email for StandMe (exhibition stand design & build).

Target:
- Company: ${context.companyName}
- Contact: ${context.contactName}
- Show: ${context.showName}
- Industry: ${context.industry}
${context.standSize ? `- Stand Size: ${context.standSize}` : ''}

Email type: ${emailTypes[context.emailNumber] || emailTypes[1]}

STRICT RULES:
- NEVER use: "I hope this email finds you well", "I wanted to reach out", "I am writing to", "Please don't hesitate", dashes (—)
- NEVER use generic subjects like "Partnership opportunity" or "Quick question"
- Max 5 lines body
- One value prop, one CTA
- Short specific subject
- Human confident tone
- Sign off as "Mo / StandMe"

Return in format:
SUBJECT: [subject line]
BODY: [email body]`;

  const result = await generateText(prompt, 'You write cold outreach emails. Short, specific, human. No corporate fluff.', 500);

  const subjectMatch = result.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = result.match(/BODY:\s*([\s\S]+)/);

  return {
    subject: subjectMatch?.[1]?.trim() || `Your stand at ${context.showName}`,
    body: bodyMatch?.[1]?.trim() || result,
  };
}

export async function generateMarketingContent(type: string, topic: string, context?: string): Promise<string> {
  const typePrompts: Record<string, string> = {
    post: 'Write a LinkedIn post',
    caption: 'Write an Instagram caption',
    campaign: 'Outline an email campaign',
    casestudy: 'Write a case study',
    portfolio: 'Write a portfolio entry',
    insight: 'Write an industry insight post',
    contentplan: 'Create a weekly content calendar (Mon-Fri)',
  };

  const prompt = `${typePrompts[type] || 'Write marketing content'} about: ${topic}

Brand: StandMe — exhibition stand design & build across MENA and Europe.
Voice: Confident, practical, no fluff. Bilingual Arabic/English where appropriate.
Audience: Exhibition managers, marketing directors.
${context ? `\nAdditional context:\n${context}` : ''}

No AI phrases, no generic filler. Be specific and actionable.`;

  return generateText(prompt, 'You are StandMe\'s marketing lead. Write brand-consistent content.', 2000);
}
