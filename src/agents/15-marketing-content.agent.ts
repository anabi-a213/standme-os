import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, appendRow, objectToRow } from '../services/google/sheets';
import { createGoogleDoc } from '../services/google/drive';
import { getFolderIdForCategory } from '../config/drive-folders';
import { generateMarketingContent } from '../services/ai/client';
import { sendToMo, formatType1 } from '../services/telegram/bot';
import { saveKnowledge, buildKnowledgeContext } from '../services/knowledge';

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

    // Get extra context: lessons learned sheet + Knowledge Base
    let extraContext = '';
    try {
      // Always pull KB context — gives the AI the full picture
      const kbContext = await buildKnowledgeContext(`${topic} ${contentType} exhibition stand`);
      if (kbContext) extraContext = `KNOWLEDGE BASE:\n${kbContext}`;

      if (contentType === 'casestudy' || contentType === 'portfolio' || contentType === 'insight') {
        const lessons = await readSheet(SHEETS.LESSONS_LEARNED);
        const relevant = lessons.filter(r =>
          r.some(cell => cell?.toLowerCase().includes(topic.toLowerCase()))
        );
        if (relevant.length > 0) {
          const lessonsText = relevant.map(r => `${r[1]}: ${r[7] || ''} ${r[8] || ''}`).join('\n');
          extraContext = `${extraContext}\n\nLESSONS LEARNED:\n${lessonsText}`.trim();
        }
      }
    } catch { /* optional */ }

    const content = await generateMarketingContent(contentType, topic || 'weekly plan', extraContext);

    // Route to /01_Sales/Outreach_Assets in the canonical folder tree
    const marketingFolderId = getFolderIdForCategory('marketing');

    // Save as Google Doc
    const docName = `${contentType.toUpperCase()} — ${topic || 'Content Plan'} — ${new Date().toISOString().split('T')[0]}`;
    const doc = await createGoogleDoc(docName, content, marketingFolderId);

    // Log to Drive Index so the team can find it
    appendRow(SHEETS.DRIVE_INDEX, objectToRow(SHEETS.DRIVE_INDEX, {
      fileName: docName,
      fileId: doc.id,
      fileUrl: doc.url,
      folderPath: '/06_Marketing/Content',
      parentFolder: marketingFolderId,
      fileType: 'Google Doc',
      lastModified: new Date().toISOString(),
      linkedProject: topic || 'marketing',
      category: `Marketing — ${contentType}`,
    })).catch(() => {});

    // Save content to KB — future content and email agents learn from it
    await saveKnowledge({
      source: doc.url,
      sourceType: 'drive',
      topic: topic || 'marketing',
      tags: `marketing,${contentType},content,brand-voice`,
      content: `${contentType.toUpperCase()} about "${topic || 'general'}": ${content.slice(0, 400)}`,
    }).catch(() => { /* non-blocking */ });

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
