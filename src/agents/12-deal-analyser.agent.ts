import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet } from '../services/google/sheets';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType3 } from '../services/telegram/bot';
import { saveKnowledge } from '../services/knowledge';

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
      await this.respond(ctx.chatId,
        'No pipeline data yet.\n\nAdd leads with `/newlead` or wait for inbound emails to be detected.\n' +
        'Run `/dealanalysis` again once you have at least one lead or lesson logged.'
      );
      return { success: true, message: 'Insufficient data', confidence: 'HIGH' };
    }

    // Determine analysis depth based on data volume
    const totalDeals = lessons.length - 1;
    const analysisDepth = totalDeals >= 3 ? 'full' : totalDeals === 2 ? 'preliminary' : 'early';

    // Analyze by shows — won/lost from LESSONS_LEARNED (col E = outcome: WON/LOST)
    // Pipeline status from LEAD_MASTER (col P = status: HOT/WARM/COLD/DISQUALIFIED)
    const showCounts = new Map<string, { won: number; lost: number; total: number; hot: number }>();

    // Pull won/lost from lessons sheet (col B = showName, col E = outcome)
    for (const row of lessons.slice(1)) {
      const show = row[1] || 'Unknown'; // col B = showName
      const outcome = (row[4] || '').toUpperCase(); // col E = outcome
      const entry = showCounts.get(show) || { won: 0, lost: 0, total: 0, hot: 0 };
      entry.total++;
      if (outcome === 'WON') entry.won++;
      if (outcome === 'LOST') entry.lost++;
      showCounts.set(show, entry);
    }

    // Count hot/active leads from lead master (col G = showName, col P = status)
    let hotLeads = 0;
    for (const row of leads.slice(1)) {
      const show = row[6] || 'Unknown';
      const status = (row[15] || '').toUpperCase();
      if (status === 'HOT') {
        hotLeads++;
        const entry = showCounts.get(show) || { won: 0, lost: 0, total: 0, hot: 0 };
        entry.hot++;
        showCounts.set(show, entry);
      }
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
      { label: 'TOP SHOW', content: topShow ? `  ${topShow[0]}: ${topShow[1].total} closed (${topShow[1].won} won, ${topShow[1].hot} hot active)` : '  No data' },
      { label: 'TOP INDUSTRY', content: topIndustry ? `  ${topIndustry[0]}: ${topIndustry[1]} leads` : '  No data' },
      { label: 'TOP SOURCE', content: topSource ? `  ${topSource[0]}: ${topSource[1]} leads` : '  No data' },
      { label: 'HOT LEADS', content: `  ${hotLeads} active hot leads in pipeline` },
      { label: 'OUTREACH', content: `  ${outreach.length - 1} emails tracked` },
    ];

    // AI insight
    const wonDeals = [...showCounts.values()].reduce((sum, v) => sum + v.won, 0);
    const lostDeals = [...showCounts.values()].reduce((sum, v) => sum + v.lost, 0);
    const totalHot = hotLeads;

    const depthNote = analysisDepth === 'early'
      ? 'This is an early-stage analysis based on limited data (1 deal). Flag patterns, not conclusions.'
      : analysisDepth === 'preliminary'
      ? 'This is a preliminary analysis based on 2 deals. Note patterns but caution on generalising.'
      : 'This is a full analysis based on 3+ deals.';

    const insight = await generateText(
      `StandMe pipeline data for this week:\n\n` +
      `Shows breakdown: ${JSON.stringify(Object.fromEntries(showCounts))}\n` +
      `Industries: ${JSON.stringify(Object.fromEntries(industryCounts))}\n` +
      `Lead sources: ${JSON.stringify(Object.fromEntries(sourceCounts))}\n` +
      `Won: ${wonDeals} | Lost: ${lostDeals} | Hot active: ${totalHot} | Lessons logged: ${lessons.length - 1}\n\n` +
      `${depthNote}\n\n` +
      `Write ONE sharp insight that Mo should act on this week. Not a summary of the data. An actual recommendation based on what the numbers suggest. Where should the team focus? What pattern is emerging? What is being left on the table?\n\n` +
      `2-3 sentences max. Direct. No em dashes. No filler.`,
      'You are a sharp sales strategist who knows the exhibition industry. You read data and tell people what it actually means for the business, not what the numbers say on the surface.',
      250
    );
    sections.push({ label: 'THIS WEEK: ACT ON THIS', content: `  ${insight}` });

    // Save weekly insight to KB so all agents have strategic context
    await saveKnowledge({
      source: 'deal-analyser-weekly',
      sourceType: 'sheet',
      topic: 'deal-analysis',
      tags: `analytics,weekly,pipeline,strategy,${new Date().toISOString().split('T')[0]}`,
      content: `Weekly insight (${new Date().toISOString().split('T')[0]}): ${insight} | Top show: ${topShow?.[0] || 'unknown'}. Top industry: ${topIndustry?.[0] || 'unknown'}. Won: ${wonDeals}, Lost: ${lostDeals}, Hot active: ${totalHot}.`,
    });

    // Save per-show performance so campaign builder can use it
    for (const [show, data] of showCounts) {
      if (data.total >= 1) {
        await saveKnowledge({
          source: 'deal-analyser-show',
          sourceType: 'sheet',
          topic: show,
          tags: `show-performance,analytics,${show.toLowerCase().replace(/\s+/g, '-')}`,
          content: `${show} performance: ${data.total} closed, ${data.won} won, ${data.lost} lost, ${data.hot} hot active. Win rate: ${data.total > 0 ? Math.round((data.won / data.total) * 100) : 0}%.`,
        }).catch(() => { /* non-blocking */ });
      }
    }

    const summary = formatType3('DEAL ANALYSIS', sections);
    await sendToMo(summary);

    if (ctx.chatId && ctx.command !== 'scheduled') {
      await this.respond(ctx.chatId, summary);
    }

    return { success: true, message: 'Deal analysis complete', confidence: 'MEDIUM' };
  }
}
