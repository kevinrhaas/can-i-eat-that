const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_BASE64_CHARS = 3_000_000;
const DAILY_FREE_NEURONS = 10_000;
const INPUT_NEURONS_PER_TOKEN = 4_410 / 1_000_000;
const OUTPUT_NEURONS_PER_TOKEN = 61_493 / 1_000_000;
const ALLOWED_ORIGINS = new Set([
  "https://kevinrhaas.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const NON_FOOD_PATTERN = /\b(soap|soap dispenser|dispenser|sanitizer|shampoo|lotion|detergent|cleaner|cleaning|cosmetic|medicine|medication|pill|capsule|battery|plastic object|toy|tool|appliance|unknown liquid)\b/;

const SYSTEM_PROMPT = `You are a strict visual edibility classifier for a demo app named "Can I Eat That?" The question is literal: can a human eat the depicted item as food?
Return only valid JSON with these keys:
{
  "verdict": "safe" | "caution" | "avoid",
  "item": "short identification",
  "confidence": "low" | "medium" | "high",
  "summary": "one clear sentence",
  "watchouts": ["short practical risk", "short practical risk"]
}
Rules:
- "Safe to touch", "safe for household use", "non-toxic surface", or "commonly used around food" does not mean edible.
- If the item is soap, sanitizer, shampoo, lotion, medicine, pills, supplements, cleaning supplies, cosmetics, batteries, plastic, metal, glass, packaging, utensils, containers, appliances, toys, tools, unknown liquids, or any household object not intended as food, the verdict must be "avoid".
- If the item is a dispenser, bottle, jar, wrapper, box, plate, cup, or container, judge the visible object itself unless edible contents are clearly visible.
- A soap dispenser is not edible. Its verdict must be "avoid" with a watchout about soap/cleaning chemicals.
- If edible food is clearly visible but freshness, allergen, cooking, storage, or contamination cannot be verified, use "caution".
- If the image shows wild mushrooms, unidentified plants, spoiled food, chemicals, medicine, animal waste, raw unsafe items, or anything ambiguous, use "avoid" or "caution".
- Do not claim certainty from appearance alone. Mention allergen, spoilage, contamination, dosage, and poisonous lookalike limits when relevant.
Return exactly one JSON object and no markdown, preface, analysis, or prose outside the JSON.`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, model: MODEL }, 200, request);
    }

    if (url.pathname === "/agree" && request.method === "POST") {
      const response = await env.AI.run(MODEL, { prompt: "agree", max_tokens: 16 });
      return json({ ok: true, response }, 200, request);
    }

    if (url.pathname !== "/analyze" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, request);
    }

    let userContext = "";
    try {
      const payload = await request.json();
      const image = validateImage(payload.image);
      userContext = typeof payload.context === "string" ? payload.context.slice(0, 800) : "";
      const prompt = `${SYSTEM_PROMPT}\n\nUser context: ${userContext || "none provided"}`;

      const modelResponse = await env.AI.run(MODEL, {
        prompt,
        image: base64ToByteArray(image.base64),
        max_tokens: 700,
        temperature: 0.1,
      });

      const text = typeof modelResponse.response === "string" ? modelResponse.response : JSON.stringify(modelResponse);
      const result = parseModelResult(text);
      return json({ result, raw: text, usage: usageSummary(modelResponse) }, 200, request);
    } catch (error) {
      return json({ result: fallbackResult(readableError(error), userContext), recovered: true, usage: emptyUsage() }, 200, request);
    }
  },
};

function validateImage(image) {
  if (!image || typeof image !== "object") {
    throw new Error("Missing image.");
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)) {
    throw new Error("Unsupported image type.");
  }

  if (typeof image.base64 !== "string" || !image.base64) {
    throw new Error("Missing image data.");
  }

  if (image.base64.length > MAX_BASE64_CHARS) {
    throw new Error("Image is too large. Use a smaller or lower-resolution photo.");
  }

  return image;
}

function base64ToByteArray(base64) {
  const binary = atob(base64);
  const bytes = new Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseModelResult(text) {
  const safeText = String(text || "");
  try {
    return normalizeResult(parseJsonText(safeText));
  } catch {
    const labeled = parseLabeledText(safeText);
    if (labeled) return normalizeResult(labeled);

    return {
      verdict: "caution",
      item: "Unclear visual result",
      confidence: "low",
      summary: "The image was analyzed, but the model response could not be converted into a structured verdict.",
      watchouts: [
        "Try a clearer, closer photo with only the item in frame.",
        "Do not rely on image analysis alone for allergens, spoilage, toxins, or poisonous lookalikes.",
      ],
    };
  }
}

function parseLabeledText(text) {
  const verdict = labeledValue(text, "verdict");
  const item = labeledValue(text, "item");
  const confidence = labeledValue(text, "confidence");
  const summary = labeledValue(text, "summary");
  const watchouts = labeledValue(text, "watchouts");

  if (!verdict && !item && !summary) return null;

  return {
    verdict: verdict || "caution",
    item: item || "Unidentified item",
    confidence: confidence || "low",
    summary: summary || "The model returned a limited result.",
    watchouts: watchouts
      ? watchouts.split(/[,;|]/).map((value) => value.trim()).filter(Boolean)
      : [],
  };
}

function labeledValue(text, label) {
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`, "i");
  return String(text || "").match(pattern)?.[1]?.replace(/\*\*/g, "").trim() || "";
}

function parseJsonText(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const objectText = firstJsonObject(cleaned);
    if (objectText) return JSON.parse(objectText);
    throw new Error("The model did not return valid JSON.");
  }
}

function firstJsonObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return "";
}

function normalizeResult(result) {
  const source = result?.response && typeof result.response === "object" ? result.response : result;
  const verdict = String(source?.verdict || "caution").toLowerCase();
  const confidence = String(source?.confidence || "low").toLowerCase();
  const normalized = {
    verdict: ["safe", "caution", "avoid"].includes(verdict) ? verdict : "caution",
    item: String(source?.item || "Unidentified item").slice(0, 120),
    confidence: ["low", "medium", "high"].includes(confidence) ? confidence : "low",
    summary: String(source?.summary || "The model returned a limited result.").slice(0, 320),
    watchouts: Array.isArray(source?.watchouts) && source.watchouts.length
      ? source.watchouts.map((item) => String(item).slice(0, 180)).slice(0, 5)
      : ["Do not rely on image analysis alone for allergens, spoilage, toxins, or poisonous lookalikes."],
  };
  return applyNonFoodOverride(normalized);
}

function applyNonFoodOverride(result) {
  const text = [result.item, result.summary, ...result.watchouts].join(" ").toLowerCase();
  if (!NON_FOOD_PATTERN.test(text)) return result;

  return {
    ...result,
    verdict: "avoid",
    confidence: result.confidence === "high" ? "high" : "medium",
    summary: `${result.item} is not food and should not be eaten.`,
    watchouts: [
      "Household objects and products can be safe to use but still unsafe to eat.",
      "Soap, cleaners, chemicals, medicines, and container hardware are ingestion hazards.",
    ],
  };
}

function fallbackResult(reason, context) {
  const readableReason = String(reason || "The free analysis service could not complete the request.").slice(0, 220);
  const result = {
    verdict: "caution",
    item: "Analysis unavailable",
    confidence: "low",
    summary: "The free model could not complete this image analysis, so treat the item as unverified.",
    watchouts: [
      readableReason,
      "Try another photo with the item centered, better lighting, and less background clutter.",
      "Do not eat unknown, wild, spoiled, contaminated, or unlabeled items based on image analysis alone.",
    ],
  };

  if (NON_FOOD_PATTERN.test(readableReason.toLowerCase()) || NON_FOOD_PATTERN.test(String(context || "").toLowerCase())) {
    return applyNonFoodOverride({
      ...result,
      item: "Non-food household item",
      summary: "The item appears to be a non-food object or product and should not be eaten.",
      watchouts: [readableReason, "Soap, dispensers, cleaners, and household products are ingestion hazards."],
    });
  }

  return result;
}

function usageSummary(modelResponse) {
  const usage = modelResponse?.usage || {};
  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || promptTokens + completionTokens);
  const estimatedNeurons = Math.max(1, Math.ceil(
    promptTokens * INPUT_NEURONS_PER_TOKEN +
    completionTokens * OUTPUT_NEURONS_PER_TOKEN
  ));

  return {
    dailyFreeNeurons: DAILY_FREE_NEURONS,
    estimatedNeurons,
    promptTokens,
    completionTokens,
    totalTokens,
    reset: "daily",
  };
}

function emptyUsage() {
  return {
    dailyFreeNeurons: DAILY_FREE_NEURONS,
    estimatedNeurons: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reset: "daily",
  };
}

function json(body, status, request) {
  return Response.json(body, {
    status,
    headers: corsHeaders(request),
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://kevinrhaas.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function readableError(error) {
  return error?.message || String(error) || "Unknown error.";
}
