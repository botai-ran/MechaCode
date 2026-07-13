import { useCallback, useState } from "react";
import { useChatStore, useActiveConversation, useConversationSummaries } from "./stores/chat-store";
import { useAgentConfig } from "./hooks/useAgentConfig";
import { useAgentRun } from "./hooks/useAgentRun";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { ChatPanel } from "./features/chat/components/ChatPanel";
import { ConversationSidebar } from "./features/chat/components/ConversationSidebar";

function App() {
  // --- Init ---
  useAgentConfig();
  useKeyboardShortcuts();

  // --- Sidebar collapse ---
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = useCallback(
    () => setSidebarCollapsed((v) => !v),
    []
  );

  // --- Store state ---
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const draft = useChatStore((s) => s.draft);
  const provider = useChatStore((s) => s.provider);
  const availableProviders = useChatStore((s) => s.availableProviders);
  const isSending = useChatStore((s) => s.isSending);
  const errorMessage = useChatStore((s) => s.errorMessage);
  const securitySnapshot = useChatStore((s) => s.securitySnapshot);

  // --- Actions ---
  const setDraft = useChatStore((s) => s.setDraft);
  const setProvider = useChatStore((s) => s.setProvider);
  const newConversation = useChatStore((s) => s.newConversation);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const setWorkspaceRoot = useChatStore((s) => s.setWorkspaceRoot);

  // --- Derived data ---
  const activeConversation = useActiveConversation();
  const conversationSummaries = useConversationSummaries();

  // --- Agent run ---
  const { startRun, cancelRun, approveToolCall, runStatus } = useAgentRun();

  // --- Handlers ---
  const handleStartRun = useCallback(() => {
    startRun(draft);
  }, [startRun, draft]);

  const handleWorkspaceRootChange = useCallback(
    (root: string) => {
      if (activeConversation) {
        setWorkspaceRoot(activeConversation.id, root);
      }
    },
    [activeConversation, setWorkspaceRoot]
  );

  const handleNewConversation = useCallback(() => {
    if (isSending) return;
    newConversation();
  }, [isSending, newConversation]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (isSending) return;
      selectConversation(id);
    },
    [isSending, selectConversation]
  );

  // --- Render ---
  if (!activeConversation) {
    return null;
  }

  return (
    <main className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <ConversationSidebar
        conversations={conversationSummaries}
        activeConversationId={activeConversationId}
        disabled={isSending}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
      />

      <ChatPanel
        conversation={activeConversation}
        messages={activeConversation.messages}
        draft={draft}
        errorMessage={errorMessage}
        isSending={isSending}
        runStatus={runStatus}
        workspaceRoot={activeConversation.workspaceRoot}
        securitySnapshot={securitySnapshot}
        availableProviders={availableProviders}
        provider={provider}
        sidebarCollapsed={sidebarCollapsed}
        onDraftChange={setDraft}
        onToggleSidebar={toggleSidebar}
        onWorkspaceRootChange={handleWorkspaceRootChange}
        onProviderChange={setProvider}
        onSubmitMessage={handleStartRun}
        onCancelRun={cancelRun}
        onResolveToolApproval={approveToolCall}
        onNewConversation={handleNewConversation}
      />
    </main>
  );
}

export default App;
