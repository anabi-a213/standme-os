import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { motion } from 'motion/react';
import { Settings } from 'lucide-react';
import { KanbanBoard } from '../components/workspace/kanban-board';
import { LeadStatsPanel } from '../components/workspace/lead-stats-panel';
import { OutreachPanel } from '../components/workspace/outreach-panel';
import { DeadlinesTimeline } from '../components/workspace/deadlines-timeline';
import { useDashboard } from '../../context/dashboard-context';

interface OutletContext {
  runningCommands: string[];
  runningAgentIds: string[];
}

export function WorkspaceView() {
  const { triggerAgent } = useDashboard();
  const [customizePanelOpen, setCustomizePanelOpen] = useState(false);

  const handleCommandClick = (cmd: string) => triggerAgent(cmd);

  return (
    <div className="ml-[var(--sidebar-width)] mr-[var(--right-panel-width)] mt-[var(--topbar-height)] h-[calc(100vh-var(--topbar-height))] overflow-auto bg-[var(--bg-primary)]">
      <div className="h-full p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">Workspace</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Real-time visibility into Trello, Sheets, Drive, and outreach
            </p>
          </div>

          <motion.button
            onClick={() => setCustomizePanelOpen(!customizePanelOpen)}
            className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm text-[var(--text)] transition-all hover:border-[var(--gold)]/30 hover:bg-[var(--surface-2)]"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Settings className="h-4 w-4" />
            Customize Layout
          </motion.button>
        </div>

        {/* Workspace Grid */}
        <div className="grid h-[calc(100%-80px)] gap-4" style={{ gridTemplateRows: '60% 40%' }}>
          {/* Top Row - 3 panels */}
          <div className="grid grid-cols-12 gap-4">
            {/* Pipeline Board - 50% */}
            <div className="col-span-6">
              <KanbanBoard onCommandClick={handleCommandClick} />
            </div>

            {/* Lead Stats - 25% */}
            <div className="col-span-3">
              <LeadStatsPanel />
            </div>

            {/* Outreach Status - 25% */}
            <div className="col-span-3">
              <OutreachPanel onCommandClick={handleCommandClick} />
            </div>
          </div>

          {/* Bottom Row - Timeline */}
          <div className="w-full">
            <DeadlinesTimeline onCommandClick={handleCommandClick} />
          </div>
        </div>
      </div>
    </div>
  );
}
