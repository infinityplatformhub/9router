// Response metadata Claude Code needs for retry decisions and usage limits.
// Keep the list of rate-limit fields open as Anthropic adds new counters.
export function withAnthropicResponseHeaders(headers, upstreamHeaders, provider) {
  const result = new Headers(headers);
  if (provider !== "claude" && provider !== "anthropic" && !provider?.startsWith?.("anthropic-compatible-")) return result;
  upstreamHeaders?.forEach?.((value, name) => {
    const key = name.toLowerCase();
    if (key === "retry-after" || key === "x-should-retry" || key.startsWith("anthropic-ratelimit-")) {
      result.set(name, value);
    }
  });
  return result;
}
