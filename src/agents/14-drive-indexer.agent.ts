import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { appendRow, readSheet, updateRange, objectToRow } from '../services/google/sheets';
import { listFiles, DriveFile } from '../services/google/drive';
import { sendToMo, formatType2 } from '../services/telegram/bot';

export class DriveIndexerAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Drive Indexer',
    id: 'agent-14',
    description: 'Index Google Drive for instant file lookup',
    commands: ['/indexdrive', '/findfile'],
    schedule: '0 8 * * 1', // Monday 8am weekly
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/findfile') {
      return this.findFile(ctx);
    }

    await this.respond(ctx.chatId, 'Indexing Google Drive...');

    try {
      const files = await listFiles();
      let indexed = 0;
      let unlinked = 0;

      // Read existing leads for project matching
      const leads = await readSheet(SHEETS.LEAD_MASTER);
      const companyNames = leads.slice(1).map(r => (r[2] || '').toLowerCase());

      for (const file of files) {
        // Categorize file
        const category = this.categorizeFile(file);
        const linkedProject = this.matchToProject(file, companyNames);
        if (!linkedProject) unlinked++;

        await appendRow(SHEETS.DRIVE_INDEX, objectToRow(SHEETS.DRIVE_INDEX, {
          fileName: file.name,
          fileId: file.id,
          fileUrl: file.webViewLink,
          folderPath: '',
          parentFolder: file.parents?.[0] || '',
          fileType: file.mimeType,
          lastModified: file.modifiedTime,
          linkedProject: linkedProject || '',
          category,
        }));

        indexed++;
      }

      const summary = `Drive indexed: ${indexed} files, ${indexed - unlinked} linked, ${unlinked} unlinked`;
      await sendToMo(formatType2('Drive Index Complete', summary));
      await this.respond(ctx.chatId, `✅ ${summary}`);

      return { success: true, message: summary, confidence: 'HIGH' };
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to index Drive: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  private async findFile(ctx: AgentContext): Promise<AgentResponse> {
    const query = ctx.args.trim();
    if (!query) {
      await this.respond(ctx.chatId, 'Usage: /findfile [search term]');
      return { success: false, message: 'No query', confidence: 'LOW' };
    }

    // Search the index
    const index = await readSheet(SHEETS.DRIVE_INDEX);
    const matches = index.filter(r =>
      r.some(cell => cell?.toLowerCase().includes(query.toLowerCase()))
    ).slice(0, 10);

    if (matches.length === 0) {
      await this.respond(ctx.chatId, `No files found matching "${query}".`);
      return { success: true, message: 'No matches', confidence: 'HIGH' };
    }

    const list = matches.map(r => `  ${r[0] || '?'}\n   ${r[2] || 'No URL'}`).join('\n\n');
    await this.respond(ctx.chatId, `*Files matching "${query}":*\n\n${list}`);

    return { success: true, message: `${matches.length} files found`, confidence: 'HIGH' };
  }

  private categorizeFile(file: DriveFile): string {
    const name = file.name.toLowerCase();
    const mime = file.mimeType.toLowerCase();

    if (name.includes('brief') || name.includes('concept')) return 'Brief';
    if (name.includes('proposal') || name.includes('quote')) return 'Proposal';
    if (name.includes('contractor') || name.includes('supplier')) return 'Contractor';
    if (name.includes('lesson') || name.includes('review')) return 'Lessons Learned';
    if (name.includes('reference') || name.includes('design')) return 'Design Reference';
    if (mime.includes('pdf')) return 'Organiser PDF';
    return 'Other';
  }

  private matchToProject(file: DriveFile, companyNames: string[]): string | null {
    const fileName = file.name.toLowerCase();
    for (const company of companyNames) {
      if (company && company.length > 2 && fileName.includes(company)) {
        return company;
      }
    }
    return null;
  }
}
