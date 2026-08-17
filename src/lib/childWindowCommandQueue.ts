import type { ChildWindowCommandName } from "./childWindowProtocol";

export interface ChildWindowCommandEnvelope {
  event: ChildWindowCommandName;
  payload: unknown;
}

interface ChildWindowCommandState {
  token: string;
  expectedEvent: ChildWindowCommandName;
  status: "loading" | "ready" | "failed";
  pending: ChildWindowCommandEnvelope[];
}

/**
 * 父窗口只在内存中保存尚未被子页面消费的命令。状态以窗口 label 和 ready token
 * 共同隔离，避免已销毁 WebView 的迟到事件释放新窗口队列。
 */
export class ChildWindowCommandQueue {
  private readonly states = new Map<string, ChildWindowCommandState>();

  register(label: string, token: string, expectedEvent: ChildWindowCommandName) {
    const current = this.states.get(label);
    if (current?.token === token && current.expectedEvent === expectedEvent) return;

    this.states.set(label, {
      token,
      expectedEvent,
      status: "loading",
      pending: [],
    });
  }

  dispatch(
    label: string,
    event: ChildWindowCommandName,
    payload: unknown,
  ): ChildWindowCommandEnvelope[] {
    const command = { event, payload };
    const state = this.states.get(label);
    if (!state || state.expectedEvent !== event || state.status === "ready") {
      return [command];
    }
    if (state.status === "failed") return [];

    state.pending.push(command);
    return [];
  }

  markReady(
    label: string,
    token: string,
    event: ChildWindowCommandName,
  ): ChildWindowCommandEnvelope[] {
    const state = this.states.get(label);
    if (!state || state.token !== token || state.expectedEvent !== event) return [];
    state.status = "ready";
    return state.pending.splice(0);
  }

  markLoading(label: string, token: string) {
    const state = this.states.get(label);
    if (!state || state.token !== token) return false;
    if (state.status === "failed") return false;

    state.status = "loading";
    return true;
  }

  markFailed(label: string, token: string) {
    const state = this.states.get(label);
    if (!state || state.token !== token) return false;

    state.status = "failed";
    state.pending = [];
    return true;
  }

  isFailed(label: string, token?: string) {
    const state = this.states.get(label);
    if (!state || state.status !== "failed") return false;
    return token === undefined || state.token === token;
  }

  clear(label: string) {
    this.states.delete(label);
  }
}
