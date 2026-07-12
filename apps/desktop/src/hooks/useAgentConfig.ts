import { useEffect } from "react";
import { getAgentConfig } from "../features/chat/agent-client";
import { useChatStore } from "../stores/chat-store";
import type { RuntimeProviderId } from "../features/chat/types";

export function useAgentConfig() {
  useEffect(() => {
    let isMounted = true;

    getAgentConfig()
      .then((config) => {
        if (!isMounted) return;

        const state = useChatStore.getState();
        state.setAvailableProviders(config.availableProviders);
        state.setDefaultWorkspaceRoot(config.defaultWorkspaceRoot);
        state.setSecuritySnapshot(config.securitySnapshot);

        if (!state.defaultWorkspaceRoot) {
          state.setWorkspaceRoot("current", config.defaultWorkspaceRoot);
        }

        const newProvider: RuntimeProviderId = config.availableProviders.includes(
          state.provider
        )
          ? state.provider
          : config.defaultProvider;
        state.setProvider(newProvider);
      })
      .catch((error) => {
        if (isMounted) {
          const message =
            error instanceof Error ? error.message : String(error);
          const normalizedMessage = message.replace(/^Error:\s*/i, "");
          useChatStore.getState().setErrorMessage(
            normalizedMessage.startsWith("错误：")
              ? normalizedMessage
              : `错误：${normalizedMessage}`
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);
}
