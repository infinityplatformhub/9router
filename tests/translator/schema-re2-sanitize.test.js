import { describe, expect, it } from "vitest";

import {
  normalizeResponsesToolParameters,
  stripUnsupportedToolSchema,
} from "open-sse/translator/formats/responsesApi.js";
import { CodexExecutor } from "open-sse/executors/codex.js";
import { openaiToOpenAIResponsesRequest } from "open-sse/translator/request/openai-responses.js";

// The exact shape that made Codex 400 with "Invalid schema for function 'Artifact'":
// lookahead + \p{…} in `pattern`, plus `propertyNames` and a nested `$schema`.
const ARTIFACT_FIELD_PATTERN = "^(?!__.*__$)[^\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\"\\\\./[\\]]{1,200}$";

const ARTIFACT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    field: { type: "string", pattern: ARTIFACT_FIELD_PATTERN },
    doc_id: { type: "string", pattern: "^[A-Za-z0-9_.~:@+-]{1,200}$" },
    capabilities: {
      type: "object",
      propertyNames: { maxLength: 64, minLength: 1, type: "string" },
      additionalProperties: {},
    },
  },
  required: ["field"],
};

function collectKeys(node, found = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectKeys(n, found));
    return found;
  }
  if (!node || typeof node !== "object") return found;
  for (const [k, v] of Object.entries(node)) {
    found.add(k);
    collectKeys(v, found);
  }
  return found;
}

describe("RE2-unsupported tool schema sanitizing", () => {
  it("drops the keywords Codex rejects but keeps the schema shape", () => {
    const clean = normalizeResponsesToolParameters(ARTIFACT_SCHEMA);
    const keys = collectKeys(clean);

    expect(keys.has("$schema")).toBe(false);
    expect(keys.has("propertyNames")).toBe(false);
    // The lookahead pattern is gone, the field itself survives
    expect(clean.properties.field.pattern).toBeUndefined();
    expect(clean.properties.field.type).toBe("string");
    // A plain RE2-safe pattern is untouched
    expect(clean.properties.doc_id.pattern).toBe("^[A-Za-z0-9_.~:@+-]{1,200}$");
    // Structure preserved
    expect(clean.required).toEqual(["field"]);
    expect(clean.additionalProperties).toBe(false);
    expect(clean.properties.capabilities.type).toBe("object");
  });

  it("does not mutate the caller's schema", () => {
    const input = structuredClone(ARTIFACT_SCHEMA);
    normalizeResponsesToolParameters(input);
    expect(input.properties.field.pattern).toBe(ARTIFACT_FIELD_PATTERN);
    expect(input.$schema).toBeDefined();
  });

  it("strips every RE2-unsupported regex construct", () => {
    const cases = [
      "^(?!x)$",          // negative lookahead
      "^(?=x)",           // positive lookahead
      "(?<=a)b",          // lookbehind
      "\\p{L}+",          // unicode property
      "\\P{L}+",          // negated unicode property
      "(a)\\1",           // backreference
    ];
    for (const pattern of cases) {
      const out = stripUnsupportedToolSchema({ type: "string", pattern });
      expect(out.pattern, `expected ${pattern} to be stripped`).toBeUndefined();
    }
  });

  it("keeps RE2-safe patterns", () => {
    const cases = ["^[a-z]+$", "\\d{1,3}", "^(foo|bar)$", "[^\\s]+"];
    for (const pattern of cases) {
      const out = stripUnsupportedToolSchema({ type: "string", pattern });
      expect(out.pattern, `expected ${pattern} to survive`).toBe(pattern);
    }
  });

  it("still normalizes empty/invalid parameters to an object schema", () => {
    expect(normalizeResponsesToolParameters(null)).toEqual({ type: "object", properties: {} });
    expect(normalizeResponsesToolParameters([])).toEqual({ type: "object", properties: {} });
    expect(normalizeResponsesToolParameters({ type: "object" })).toEqual({ type: "object", properties: {} });
  });
});

describe("Artifact tool reaches Codex without RE2-unsupported keywords", () => {
  it("sanitizes via the chat → responses translator", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-5.5", {
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "Artifact", parameters: ARTIFACT_SCHEMA } }],
    }, true);

    const keys = collectKeys(out.tools[0].parameters);
    expect(keys.has("$schema")).toBe(false);
    expect(keys.has("propertyNames")).toBe(false);
    expect(out.tools[0].parameters.properties.field.pattern).toBeUndefined();
  });

  it("sanitizes via the Codex executor for native Responses clients", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [{ type: "function", name: "Artifact", parameters: structuredClone(ARTIFACT_SCHEMA) }],
      stream: true,
    };

    executor.transformRequest("gpt-5.5", body, true, {
      connectionId: "test-artifact-schema",
      providerSpecificData: {},
    });

    const keys = collectKeys(body.tools[0].parameters);
    expect(keys.has("$schema")).toBe(false);
    expect(keys.has("propertyNames")).toBe(false);
    expect(body.tools[0].parameters.properties.field.pattern).toBeUndefined();
    expect(body.tools[0].name).toBe("Artifact");
  });
});
