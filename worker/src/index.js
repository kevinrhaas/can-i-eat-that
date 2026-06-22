const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_BASE64_CHARS = 3_000_000;
const ALLOWED_ORIGINS = new Set([
  "https://kevinrhaas.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const SYSTEM_PROMPT = `You are a cautious visual food safety assistant for a demo app named "Can I Eat That?" Analyze the image and return only valid JSON with these keys:
{
  "verdict": "safe" | "caution" | "avoid",
  "item": "short identification",
  "confidence": "low" | "medium" | "high",
  "summary": "one clear sentence",
  "watchouts": ["short practical risk", "short practical risk"]
}
Rules: If the image shows wild mushrooms, unidentified plants, spoiled food, chemicals, medicine, animal waste, raw unsafe items, or anything ambiguous, use caution or avoid. Do not claim certainty from appearance alone. Mention allergen, spoilage, contamination, dosage, and poisonous lookalike limits when relevant. Return exactly one JSON object and no markdown, preface, analysis, or prose outside the JSON.`;

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

    try {
      const payload = await request.json();
      const image = validateImage(payload.image);
      const context = typeof payload.context === "string" ? payload.context.slice(0, 800) : "";
      const prompt = `${SYSTEM_PROMPT}\n\nUser context: ${context || "none provided"}`;

      const modelResponse = await env.AI.run(MODEL, {
        prompt,
        image: base64ToByteArray(image.base64),
        max_tokens: 700,
        temperature: 0.1,
      });

      const text = modelResponse.response || "";
      const result = parseModelResult(text);
      return json({ result, raw: text }, 200, request);
    } catch (error) {
      return json({ error: readableError(error) }, 400, request);
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
  try {
    return normalizeResult(parseJsonText(text));
  } catch {
    const labeled = parseLabeledText(text);
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
  return text.match(pattern)?.[1]?.replace(/\*\*/g, "").trim() || "";
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
  const verdict = String(result?.verdict || "caution").toLowerCase();
  const confidence = String(result?.confidence || "low").toLowerCase();
  return {
    verdict: ["safe", "caution", "avoid"].includes(verdict) ? verdict : "caution",
    item: String(result?.item || "Unidentified item").slice(0, 120),
    confidence: ["low", "medium", "high"].includes(confidence) ? confidence : "low",
    summary: String(result?.summary || "The model returned a limited result.").slice(0, 320),
    watchouts: Array.isArray(result?.watchouts) && result.watchouts.length
      ? result.watchouts.map((item) => String(item).slice(0, 180)).slice(0, 5)
      : ["Do not rely on image analysis alone for allergens, spoilage, toxins, or poisonous lookalikes."],
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
