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
  const prompt = `You are writing a concept brief for an exhibition stand project at StandMe.

CLIENT: ${context.clientName}
SHOW: ${context.showName}, ${context.showCity}
STAND SIZE: ${context.standSize} sqm
BUDGET: ${context.budget}
INDUSTRY: ${context.industry}
${context.brandGuidelines ? `BRAND GUIDELINES: ${context.brandGuidelines}` : ''}
${context.lessonsLearned ? `PAST LESSONS FROM SIMILAR PROJECTS:\n${context.lessonsLearned}` : ''}

Write a concept brief using this exact structure. Be specific and visual. No filler sentences:

---

# Concept Brief: ${context.clientName} at ${context.showName}

## Show Context
2-3 sentences on what this show is about, who attends, what the competitive environment looks like on the floor, and why it matters for this client specifically.

## Client Objectives
What does a company in the ${context.industry} sector typically want to achieve at this show? Visitors to attract, deals to close, brand story to tell. Keep it sharp.

## Design Concept A: [Give it a real name]
A single, clear concept direction. Describe the spatial experience: how a visitor approaches, what they see first, how they move through, what moment stops them. Materials, lighting mood, key visual element. Why this works for this client and show.

## Design Concept B: [Give it a real name]
A second direction, meaningfully different from A. Different spatial logic or brand story. Same level of detail.

## Design Concept C: [Give it a real name]
A third direction, the bold/experimental option. Push the brief here.

## AI Image Prompts
For each concept above, write one Midjourney prompt ready to paste:
- Concept A: exhibition stand, [specific details], photorealistic, trade show floor, dramatic lighting, 8K
- Concept B: ...
- Concept C: ...

## Key Constraints
- ${context.standSize} sqm: what that space actually allows (traffic flow, zones, meeting area)
- Budget reality: what this budget tier enables and what it rules out
- Show-specific rules or typical restrictions at ${context.showName}

## Recommended Next Step
One specific action. Not "discuss further." What exactly should happen in the next 48 hours.

---

Write with confidence. This is a document a client will read and get excited about. Every sentence earns its place.`;

  return generateText(
    prompt,
    'You are StandMe\'s senior creative director. You have 15 years designing exhibition stands across MENA and Europe. You write briefs that win projects. Your language is precise, visual, and confident. Never use em dashes. Never use corporate filler.',
    3500
  );
}

export async function generateOutreachEmail(context: {
  companyName: string;
  contactName: string;
  showName: string;
  industry: string;
  standSize?: string;
  emailNumber: number;
}): Promise<{ subject: string; body: string }> {

  const hooks: Record<number, string> = {
    1: `First outreach. Open with something specific about their company or show presence. One sharp observation, one clear value, one low-friction ask. Show you have done your homework.`,
    2: `Follow-up after no reply. Different angle completely. Do not reference the first email. Lead with insight, value, or a question they cannot ignore. Not "just following up."`,
    3: `Final touch. Short. Human. The kind of email a real person sends on a Friday afternoon. No pressure. Easy to reply yes or no.`,
  };

  const prompt = `Write a cold outreach email for StandMe.

ABOUT STANDME: We design and build custom exhibition stands. MENA and Europe. Shows like Arab Health, Gulfood, Hannover Messe, ISE, MEDICA, Interpack. Our work is creative, fast, and built to perform on the floor.

TARGET:
Company: ${context.companyName}
Contact: ${context.contactName}
Show: ${context.showName}
Industry: ${context.industry}
${context.standSize ? `Stand Size: ${context.standSize} sqm` : ''}

EMAIL TYPE: ${hooks[context.emailNumber] || hooks[1]}

RULES (non-negotiable):
- Never use: "I hope this email finds you well", "I wanted to reach out", "I am writing to", "Please do not hesitate", "synergy", "leverage", "touch base"
- Never use em dashes
- Subject: specific, not generic. Not "Partnership Opportunity." Something they will open.
- Body: maximum 5 lines. One clear value statement. One CTA.
- Tone: direct, warm, confident. Like a smart colleague, not a sales robot.
- Sign off as: Mo / StandMe

Return in this exact format:
SUBJECT: [subject line]
BODY:
[email body]`;

  const result = await generateText(
    prompt,
    'You write outreach emails that get replies. You know the exhibition industry. Your emails feel human, specific, and worth reading. No em dashes. No fluff. No corporate speak.',
    500
  );

  const subjectMatch = result.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = result.match(/BODY:\s*([\s\S]+)/);

  return {
    subject: subjectMatch?.[1]?.trim() || `Your stand at ${context.showName}`,
    body: bodyMatch?.[1]?.trim() || result,
  };
}

export async function generateMarketingContent(type: string, topic: string, context?: string): Promise<string> {

  const typeInstructions: Record<string, string> = {
    post: `Write a LinkedIn post. This should stop the scroll. Open with a statement or question that hits. No "I am excited to share." No fluff opener. Get to the point in line 1. Use short paragraphs. End with one strong insight or call to reflect. 150-250 words. No em dashes.`,

    caption: `Write an Instagram caption for StandMe. Energy, personality, visual. Open line must pull people in immediately. 3-4 short punchy lines. One hashtag block at the end (8-12 relevant hashtags: #exhibitiondesign #tradeshow #standdesign #MENA #Gulfood etc). No em dashes.`,

    campaign: `Design a 3-email campaign sequence. Each email is different in angle and tone. Email 1: awareness and hook. Email 2: proof and value. Email 3: low-friction CTA. For each, write full subject + body. Max 5 lines per email. No em dashes. No corporate speak.`,

    casestudy: `Write a case study in story format. Structure: Challenge (what the client needed and why it was difficult), Approach (how StandMe thought about it and what was designed), Result (what happened on the show floor, visitor response, client outcome). Specific numbers where possible. 400-500 words. Write it like a story, not a brochure. No em dashes.`,

    portfolio: `Write a portfolio entry for a StandMe project. Describe the stand as if the reader is standing in front of it: what they see, how they move through it, what makes it different. Include: the brief challenge, the design solution, the standout detail. 200-300 words. Confident and visual. No em dashes.`,

    insight: `Write an industry insight post. StandMe's point of view on a trend, challenge, or shift in the exhibition world. Take a real position. Not "there are pros and cons." What do we actually think? Reference real shows, real industry dynamics in MENA and Europe. 300-400 words. No em dashes.`,

    contentplan: `Create a 5-day LinkedIn content calendar (Monday to Friday). Each day: one post idea with a clear angle, the opening line, and 2 visual suggestions (what to photograph or design). Themes should rotate: project showcase, industry insight, behind the scenes, client story, thought leadership. Make every day feel different. No em dashes.`,
  };

  const instruction = typeInstructions[type] || `Write ${type} marketing content about the topic.`;

  const prompt = `${instruction}

TOPIC: ${topic}
${context ? `CONTEXT / REFERENCE MATERIAL:\n${context}` : ''}

BRAND: StandMe. Exhibition stand design and build. Operating across MENA and Europe. Key shows: Arab Health, Gulfood, Interpack, Hannover Messe, ISE, MEDICA, Big 5, Automechanika. Our voice is confident, creative, and grounded. We know the floor. We know what works.

Write it now. No preamble, no "here is your content." Just the content itself.`;

  return generateText(
    prompt,
    'You are StandMe\'s brand voice. You know the exhibition industry inside out: the pressure of build week, what it feels like when a stand draws a crowd, the difference between a shell scheme and a custom build. Your writing is specific, energetic, and human. Never use em dashes. Never use corporate filler. Make every word count.',
    2500
  );
}
