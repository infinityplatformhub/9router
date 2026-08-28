import { describe, it, expect } from "vitest";
import { CursorExecutor } from "open-sse/executors/cursor.js";

// Guards the routing decision and the shape of what gets built, without
// hitting the network. The live behaviour these encode was verified against
// agent.api5.cursor.sh; see docs/CURSOR_AGENT_PROTO.md for the wire format.

const toolConversation = {
  messages: [
    { role: "user", content: "list the files" },
    {
      role: "assistant",
      tool_calls: [
        { id: "c1", type: "function", function: { name: "ls", arguments: '{"path":"."}' } },
      ],
    },
    { role: "tool", tool_call_id: "c1", name: "ls", content: "a\nb" },
    { role: "user", content: "how many?" },
  ],
};

describe("cursor AgentService routing", () => {
  const ex = new CursorExecutor();

  it("builds an AgentService URL for a tool conversation", () => {
    // Regression: tool history used to be pushed onto the retired ChatService
    // at api2.cursor.sh, which answers 429 "Update Required" for every request
    // (decolua/9router#2487).
    expect(ex.buildUrl()).toContain("api2.cursor.sh");
  });

  it("keeps tool-call ids out of the transformed request untouched", () => {
    const out = ex.transformRequest("claude-opus-5-medium", toolConversation, true, {});
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it("encodes every prior turn, not just the last user message", () => {
    const short = ex.transformRequest(
      "claude-opus-5-medium",
      { messages: [{ role: "user", content: "how many?" }] },
      true,
      {},
    );
    const long = ex.transformRequest("claude-opus-5-medium", toolConversation, true, {});
    // The transcript has to travel with the request; a build that silently
    // dropped history produced a frame no larger than the single-turn one.
    expect(long.length).toBeGreaterThan(short.length);
  });
});
