import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

const GROQ_DEFAULT = "openai/gpt-oss-120b"; // supports tool calling AND json_schema (llama-3.3 lacks the latter)

function getOpenRouterModel() {
  const provier = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

  const modelId = process.env.OPENROUTER_DEFAULT_MODEL;
  if (!modelId) throw new Error("OPENROUTER_DEFAULT_MODEL is not set in .env");

  return provier(modelId);
}

type ModelObject = Exclude<LanguageModel, string>;

/** Try primary; on any error, warn once and retry the call on fallback. */
function withFallback(primary: ModelObject, fallback: () => ModelObject): ModelObject {
  const rescue = (op: "doGenerate" | "doStream") => async (options: any) => {
    try {
      return await (primary[op] as any)(options);
    } catch (err) {
      console.warn(
        `[ai] ${primary.provider}/${primary.modelId} failed (${err instanceof Error ? err.message : err}); falling back to OpenRouter`,
      );
      return (fallback()[op] as any)(options);
    }
  };

  return new Proxy(primary, {
    get(target, prop, receiver) {
      if (prop === "doGenerate" || prop === "doStream") return rescue(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function getAgentModel(): ModelObject {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return getOpenRouterModel() as ModelObject;

  const groq = createGroq({ apiKey: groqKey });
  const primary = groq(process.env.GROQ_DEFAULT_MODEL || GROQ_DEFAULT) as ModelObject;
  return withFallback(primary, () => getOpenRouterModel() as ModelObject);
}
