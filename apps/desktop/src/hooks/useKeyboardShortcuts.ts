import { useEffect } from "react";
import { useChatStore } from "../stores/chat-store";

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Ctrl/Cmd+N: new conversation (only when not typing in input)
      if ((event.metaKey || event.ctrlKey) && event.key === "n") {
        if (!isInput) {
          event.preventDefault();
          const state = useChatStore.getState();
          if (!state.isSending) {
            state.newConversation();
          }
        }
        return;
      }

      // Escape: clear error message
      if (event.key === "Escape") {
        useChatStore.getState().setErrorMessage(null);
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
