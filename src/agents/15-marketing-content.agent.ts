import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet } from '../services/google/sheets';
import { createGoogleDoc } from '../services/google/drive';
import { generateMarketingContent } from '../services/ai/client';
import { sendToMo, formatType1 } from '../services/telegram/bot';

export class MarketingContentAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Marketing Content Agent',
    id: 'agent-15',
    description: 'Generate brand-consistent marketing content',
    commands: ['/post', '/caption', '/campaign', '/casestudy', '/portfolio', '/insight', '/contentplan'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const contentType = ctx.command.replace('/', '');
    const topic = ctx.args.trim();

    if (!topic && contentType !== 'contentplan') {
      await this.respond(ctx.chatId, `Usage: ${ctx.command} [topic]\n\nCommands: /post /caption /campaign /casestudy /portfolio /insight /contentplan`);
      return { success: false, message: 'No topic provided', confidence: 'LOW' };
    }

    await this.respond(ctx.chatId, `Generating ${contentType}...`);

    // Get extra context for case studies
    let extraContext = '';
    if (contentType === 'casestudy') {
      try {
        const lessons = await readSheet(SHEETS.LESSONS_LEARNED);
        const relevant = lessons.filter(r =>
          r.some(cell => cell?.toLowerCase().includes(topic.toLowerCase()))
        );
        if (relevant.length > 0) {
          extraContext = relevant.map(r => `${r[1]}: ${r[7] || ''} ${r[8] || ''}`).join('\n');
        }
      } catch { /* optional */ }
    }

    const content = await generateMarketingContent(contentType, topic || 'weekly plan', extraContext);

    // Save as Google Doc
    const doc = await createGoogleDoc(
      `${contentType.toUpperCase()} — ${topic || 'Content Plan'} — ${new Date().toISOString().split('T')[0]}`,
      content
    );

    // Send to Mo for approval
    await sendToMo(formatType1(
      `${contentType.toUpperCase()}: ${topic || 'Plan'}`,
      'Content ready for review',
      `${content.substring(0, 800)}${content.length > 800 ? '...' : ''}\n\nFull doc: ${doc.url}`,
      `content_${Date.now()}`
    ));

    await this.respond(ctx.chatId, `✅ ${contentType} generated.\nSent to Mo for approval.\nDoc: ${doc.url}`);

    return {
      success: true,
      message: `${contentType} content created`,
      confidence: 'HIGH',
      data: { docUrl: doc.url },
    };
  }
}
