import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet } from '../services/google/sheets';
import { createGoogleDoc } from '../services/google/drive';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType3 } from '../services/telegram/bot';

export class DealAnalyserAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Won/Lost Deal Analyser',
    id: 'agent-12',
    description: 'Turn lessons learned into actionable intelligence',
    commands: ['/dealanalysis'],
    schedule: '0 8 * * 1', // Monday 8am weekly
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const lessons = await readSheet(SHEETS.LESSONS_LEARNED);
    const outreach = await readSheet(SHEETS.OUTREACH_LOG);
    const leads = await readSheet(SHEETS.LEAD_MASTER);

    if (lessons.length <= 1 && leads.length <= 1) {
      await this.respond(ctx.chatId, 'Not enough data for analysis yet.');
      return { success: true, message: 'Insufficient data', confidence: 'HIGH' };
    }

    // Analyze by shows
    const showCounts = new Map<string, { won: number; lost: number; total: number }>();
    for (const row of leads.slice(1)) {
      const show = row[6] || 'Unknown';
      const status = row[15] || '';
      const entry = showCounts.get(show) || { won: 0, lost: 0, total: 0 };
      entry.total++;
      if (status === 'WON') entry.won++;
      if (status === 'LOST') entry.lost++;
      showCounts.set(show, entry);
    }

    // Analyze by industry
    const industryCounts = new Map<string, number>();
    for (const row of leads.slice(1)) {
      const industry = row[10] || 'Unknown';
      industryCounts.set(industry, (industryCounts.get(industry) || 0) + 1);
    }

    // Analyze by lead source
    const sourceCounts = new Map<string, number>();
    for (const row of leads.slice(1)) {
      const source = row[11] || 'Unknown';
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }

    // Build weekly summary
    const topShow = [...showCounts.entries()].sort((a, b) => b[1].total - a[1].total)[0];
    const topIndustry = [...industryCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topSource = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    const sections = [
      { label: 'TOP SHOW', content: topShow ? `  ${topShow[0]}: ${topShow[1].total} leads (${topShow[1].won} won)` : '  No data' },
      { label: 'TOP INDUSTRY', content: topIndustry ? `  ${topIndustry[0]}: ${topIndustry[1]} leads` : '  No data' },
      { label: 'TOP SOURCE', content: topSource ? `  ${topSource[0]}: ${topSource[1]} leads` : '  No data' },
      { label: 'OUTREACH', content: `  ${outreach.length - 1} emails tracked` },
    ];

    // AI insight
    const wonDeals = [...showCounts.values()].reduce((sum, v) => sum + v.won, 0);
    const lostDeals = [...showCounts.values()].reduce((sum, v) => sum + v.lost, 0);

    const insight = await generateText(
      `StandMe pipeline data for this week:\n\n` +
      `Shows breakdown: ${JSON.stringify(Object.fromEntries(showCounts))}\n` +
      `Industries: ${JSON.stringify(Object.fromEntries(industryCounts))}\n` +
      `Lead sources: ${JSON.stringify(Object.fromEntries(sourceCounts))}\n` +
      `Won: ${wonDeals} | Lost: ${lostDeals} | Lessons logged: ${lessons.length - 1}\n\n` +
      `Write ONE sharp insight that Mo should act on this week. Not a summary of the data. An actual recommendation based on what the numbers suggest. Where should the team focus? What pattern is emerging? What is being left on the table?\n\n` +
      `2-3 sentences max. Direct. No em dashes. No filler.`,
      'You are a sharp sales strategist who knows the exhibition industry. You read data and tell people what it actually means for the business, not what the numbers say on the surface.',
      250
    );
    sections.push({ label: 'THIS WEEK: ACT ON THIS', content: `  ${insight}` });

    const summary = formatType3('DEAL ANALYSIS', sections);
    await sendToMo(summary);

    if (ctx.chatId && ctx.command !== 'scheduled') {
      await this.respond(ctx.chatId, summary);
    }

    return { success: true, message: 'Deal analysis complete', confidence: 'MEDIUM' };
  }
}
