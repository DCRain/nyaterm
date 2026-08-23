import { useCallback, useState } from "react";
import type { HostKeyVerifyRequest } from "@/components/dialog/connections/HostKeyVerifyDialog";
import type { OtpRequest } from "@/components/dialog/connections/OtpDialog";
import type { SshAgentAuthRequest } from "@/components/dialog/connections/SshAgentAuthDialog";
import type { SshAuthRequest } from "@/components/dialog/connections/SshAuthDialog";

type SecurityPrompt =
  | { kind: "host-key"; request: HostKeyVerifyRequest }
  | { kind: "ssh-agent"; request: SshAgentAuthRequest }
  | { kind: "otp"; request: OtpRequest }
  | { kind: "ssh-auth"; request: SshAuthRequest };

function upsertSecurityPrompt(current: SecurityPrompt[], prompt: SecurityPrompt): SecurityPrompt[] {
  const index = current.findIndex((item) => item.request.requestId === prompt.request.requestId);
  if (index < 0) return [...current, prompt];
  const next = [...current];
  next[index] = prompt;
  return next;
}

export function useSecurityPromptQueue() {
  const [securityPromptQueue, setSecurityPromptQueue] = useState<SecurityPrompt[]>([]);

  const queueSecurityPrompt = useCallback((prompt: SecurityPrompt) => {
    setSecurityPromptQueue((current) => upsertSecurityPrompt(current, prompt));
  }, []);

  const removeSecurityPrompt = useCallback((requestId: string) => {
    setSecurityPromptQueue((current) =>
      current.filter((item) => item.request.requestId !== requestId),
    );
  }, []);

  const activeSecurityPrompt = securityPromptQueue[0] ?? null;

  return {
    activeHostKeyRequest:
      activeSecurityPrompt?.kind === "host-key" ? activeSecurityPrompt.request : null,
    activeSshAgentRequest:
      activeSecurityPrompt?.kind === "ssh-agent" ? activeSecurityPrompt.request : null,
    activeOtpRequest: activeSecurityPrompt?.kind === "otp" ? activeSecurityPrompt.request : null,
    activeSshAuthRequest:
      activeSecurityPrompt?.kind === "ssh-auth" ? activeSecurityPrompt.request : null,
    queueSecurityPrompt,
    removeSecurityPrompt,
  };
}
