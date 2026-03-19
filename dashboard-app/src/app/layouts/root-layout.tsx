import { Outlet } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { DashboardProvider, useDashboard } from '../../context/dashboard-context';
import { TopBar } from '../components/top-bar';
import { LeftSidebar } from '../components/left-sidebar';
import { RightPanel } from '../components/right-panel';
import { CommandPalette } from '../components/command-palette';
import { NeuralBackground } from '../components/neural-background';
import { ToastSystem } from '../components/toast-system';
import { ShortcutsOverlay } from '../components/shortcuts-overlay';
import { ApprovalBanner } from '../components/approval-banner';
import { useState, useEffect } from 'react';

function Layout() {
  const { pendingApproval, approveAction, dismissApproval, toasts, dismissToast, triggerAgent, agents, agentConfigs, systemStats, isMobile, sidebarOpen, chatOpen, toggleSidebar, toggleChat, closeSidebar, closeChat } = useDashboard();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCommandPaletteOpen(true); }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setShortcutsOpen(true); }
      if (e.key === 'Escape') { setCommandPaletteOpen(false); setShortcutsOpen(false); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  const runningAgentIds = agents.filter(a => a.state === 'running').map(a => a.id);
  // Map running agent IDs to commands for components that check by command string
  const runningCommands = agentConfigs
    .filter(c => runningAgentIds.includes(c.id))
    .flatMap(c => c.commands);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)]">
      <NeuralBackground />
      <div className="neural-mesh pointer-events-none absolute inset-0 opacity-20" />
      <div className="relative z-10 flex h-full w-full">
        <TopBar
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          systemStats={systemStats}
          agents={agents}
          isMobile={isMobile}
          onToggleSidebar={toggleSidebar}
          onToggleChat={toggleChat}
        />
        <LeftSidebar
          onCommandClick={(cmd) => triggerAgent(cmd)}
          runningCommands={runningCommands}
          agentConfigs={agentConfigs}
          isMobile={isMobile}
          isOpen={sidebarOpen}
          onClose={closeSidebar}
        />
        <Outlet context={{ runningCommands, runningAgentIds }} />
        <RightPanel
          isMobile={isMobile}
          isOpen={chatOpen}
          onClose={closeChat}
        />
      </div>

      {/* Approval banner */}
      {pendingApproval && (
        <ApprovalBanner
          isOpen={true}
          agentName={pendingApproval.agentName}
          action={pendingApproval.action}
          details={pendingApproval.details}
          onApprove={() => approveAction(pendingApproval.approvalId, true)}
          onReject={() => approveAction(pendingApproval.approvalId, false)}
        />
      )}

      <AnimatePresence>
        {commandPaletteOpen && (
          <CommandPalette
            isOpen={commandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
            onSelectCommand={(cmd) => { triggerAgent(cmd); setCommandPaletteOpen(false); }}
            agentConfigs={agentConfigs}
            runningCommands={runningCommands}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shortcutsOpen && (
          <ShortcutsOverlay isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        )}
      </AnimatePresence>

      <ToastSystem toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export function RootLayout() {
  return (
    <DashboardProvider>
      <Layout />
    </DashboardProvider>
  );
}
