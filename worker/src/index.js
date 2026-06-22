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
Rules: If the image shows wild mushrooms, unidentified plants, spoiled food, chemicals, medicine, animal waste, raw unsafe items, or anything ambiguous, use caution or avoid. Do not claim certainty from appearance alone. Mention allergen, spoilage, contamination, dosage, and poisonous lookalike limits when relevant.`;

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
      const result = parseJsonText(text);
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

function parseJsonText(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("The model did not return valid JSON.");
  }
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
