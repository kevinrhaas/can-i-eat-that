const state = {
  provider: "demo",
  image: null,
  stream: null,
};

const defaults = {
  demo: "demo-lens",
  cloudflare: "@cf/meta/llama-3.2-11b-vision-instruct",
  gemini: "gemini-3.5-flash",
  claude: "claude-sonnet-4-6",
};

const labels = {
  demo: "Demo Lens",
  cloudflare: "Free Cloudflare",
  gemini: "Gemini",
  claude: "Claude",
};

const defaultWorkerEndpoint = "https://can-i-eat-that-ai.kevinrhaas.workers.dev/analyze";

const els = {
  providerPill: document.querySelector("#providerPill"),
  cameraStream: document.querySelector("#cameraStream"),
  imagePreview: document.querySelector("#imagePreview"),
  emptyPreview: document.querySelector("#emptyPreview"),
  startCamera: document.querySelector("#startCamera"),
  capturePhoto: document.querySelector("#capturePhoto"),
  imageInput: document.querySelector("#imageInput"),
  analyzeButton: document.querySelector("#analyzeButton"),
  captureCanvas: document.querySelector("#captureCanvas"),
  statusCard: document.querySelector("#statusCard"),
  verdictDot: document.querySelector("#verdictDot"),
  verdictTitle: document.querySelector("#verdictTitle"),
  summaryText: document.querySelector("#summaryText"),
  identityText: document.querySelector("#identityText"),
  confidenceText: document.querySelector("#confidenceText"),
  watchoutsList: document.querySelector("#watchoutsList"),
  segments: Array.from(document.querySelectorAll(".segment")),
  endpointSection: document.querySelector("#endpointSection"),
  endpointInput: document.querySelector("#endpointInput"),
  rememberEndpoint: document.querySelector("#rememberEndpoint"),
  keySection: document.querySelector("#keySection"),
  apiKey: document.querySelector("#apiKey"),
  rememberKey: document.querySelector("#rememberKey"),
  modelInput: document.querySelector("#modelInput"),
  contextInput: document.querySelector("#contextInput"),
};

const systemPrompt = `You are a cautious visual food safety assistant for a demo app named "Can I Eat That?" Analyze the image and return only valid JSON with these keys:
{
  "verdict": "safe" | "caution" | "avoid",
  "item": "short identification",
  "confidence": "low" | "medium" | "high",
  "summary": "one clear sentence",
  "watchouts": ["short practical risk", "short practical risk"]
}
Rules: If the image shows wild mushrooms, unidentified plants, spoiled food, chemicals, medicine, animal waste, raw unsafe items, or anything ambiguous, use caution or avoid. Do not claim certainty from appearance alone. Mention allergen, spoilage, contamination, dosage, and poisonous lookalike limits when relevant.`;

function init() {
  setProvider("demo");
  bindEvents();
  renderStoredKey();
}

function bindEvents() {
  els.segments.forEach((button) => {
    button.addEventListener("click", () => setProvider(button.dataset.provider));
  });

  els.startCamera.addEventListener("click", startCamera);
  els.capturePhoto.addEventListener("click", capturePhoto);
  els.imageInput.addEventListener("change", handleFileInput);
  els.analyzeButton.addEventListener("click", analyzeImage);
  els.rememberKey.addEventListener("change", persistKeyPreference);
  els.apiKey.addEventListener("input", persistKeyIfAllowed);
  els.rememberEndpoint.addEventListener("change", persistEndpointPreference);
  els.endpointInput.addEventListener("input", persistEndpointIfAllowed);
}

function setProvider(provider) {
  state.provider = provider;
  els.providerPill.textContent = labels[provider];
  els.modelInput.value = defaults[provider];
  els.keySection.style.display = provider === "gemini" || provider === "claude" ? "grid" : "none";
  els.endpointSection.style.display = provider === "cloudflare" ? "grid" : "none";
  els.segments.forEach((button) => {
    button.classList.toggle("active", button.dataset.provider === provider);
  });
  renderStoredKey();
  renderStoredEndpoint();
}

function renderStoredKey() {
  const keyName = storageKey();
  const stored = localStorage.getItem(keyName);
  els.rememberKey.checked = Boolean(stored);
  els.apiKey.value = stored || "";
}

function persistKeyPreference() {
  if (!els.rememberKey.checked) {
    localStorage.removeItem(storageKey());
    return;
  }
  persistKeyIfAllowed();
}

function persistKeyIfAllowed() {
  if (els.rememberKey.checked && (state.provider === "gemini" || state.provider === "claude")) {
    localStorage.setItem(storageKey(), els.apiKey.value.trim());
  }
}

function storageKey() {
  return `can-i-eat-that:${state.provider}:api-key`;
}

function renderStoredEndpoint() {
  const stored = localStorage.getItem(endpointStorageKey());
  els.rememberEndpoint.checked = Boolean(stored);
  els.endpointInput.value = stored || defaultWorkerEndpoint;
}

function persistEndpointPreference() {
  if (!els.rememberEndpoint.checked) {
    localStorage.removeItem(endpointStorageKey());
    return;
  }
  persistEndpointIfAllowed();
}

function persistEndpointIfAllowed() {
  if (els.rememberEndpoint.checked) {
    localStorage.setItem(endpointStorageKey(), els.endpointInput.value.trim());
  }
}

function endpointStorageKey() {
  return "can-i-eat-that:cloudflare:endpoint";
}

async function startCamera() {
  try {
    stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    state.stream = stream;
    els.cameraStream.srcObject = stream;
    await els.cameraStream.play();
    showCamera();
    els.capturePhoto.disabled = false;
  } catch (error) {
    setError("Camera unavailable", readableError(error));
  }
}

function capturePhoto() {
  if (!state.stream || !els.cameraStream.videoWidth) return;
  const canvas = els.captureCanvas;
  const video = els.cameraStream;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  setImage(dataUrl, "image/jpeg");
  stopCamera();
}

function handleFileInput(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setError("Unsupported file", "Choose an image file.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => setImage(String(reader.result), file.type);
  reader.onerror = () => setError("Upload failed", "The image could not be read.");
  reader.readAsDataURL(file);
}

async function setImage(dataUrl, mimeType) {
  const prepared = await prepareImage(dataUrl, mimeType);
  state.image = {
    dataUrl: prepared.dataUrl,
    mimeType: prepared.mimeType,
    base64: prepared.dataUrl.split(",")[1],
  };
  els.imagePreview.src = prepared.dataUrl;
  showPreview();
  els.analyzeButton.disabled = false;
  setPending("Ready to analyze", "Send the image to the selected engine for a food-safety verdict.");
}

async function prepareImage(dataUrl, mimeType) {
  const image = await loadImage(dataUrl);
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = els.captureCanvas;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);

  const outputType = mimeType === "image/png" && scale === 1 ? "image/png" : "image/jpeg";
  return {
    dataUrl: canvas.toDataURL(outputType, 0.82),
    mimeType: outputType,
  };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be prepared for analysis."));
    image.src = dataUrl;
  });
}

function showCamera() {
  els.emptyPreview.style.display = "none";
  els.imagePreview.classList.remove("active");
  els.cameraStream.classList.add("active");
}

function showPreview() {
  els.emptyPreview.style.display = "none";
  els.cameraStream.classList.remove("active");
  els.imagePreview.classList.add("active");
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  els.capturePhoto.disabled = true;
  els.cameraStream.classList.remove("active");
}

async function analyzeImage() {
  if (!state.image) return;
  const apiKey = els.apiKey.value.trim();
  if ((state.provider === "gemini" || state.provider === "claude") && !apiKey) {
    setError("API key needed", `Paste a ${labels[state.provider]} key or switch to Demo.`);
    return;
  }
  if (state.provider === "cloudflare" && !workerEndpoint()) {
    setError("Worker endpoint needed", "Deploy the Cloudflare Worker or paste its /analyze endpoint.");
    return;
  }

  els.analyzeButton.disabled = true;
  document.body.classList.add("loading");
  setPending("Analyzing image", "The model is checking identification, edible risk, and obvious safety concerns.");

  try {
    const result = await runProvider(apiKey);
    renderResult(normalizeResult(result));
  } catch (error) {
    setError("Analysis failed", readableError(error));
  } finally {
    document.body.classList.remove("loading");
    els.analyzeButton.disabled = false;
  }
}

async function runProvider(apiKey) {
  if (state.provider === "demo") return demoResult();
  if (state.provider === "cloudflare") return callCloudflare();
  if (state.provider === "gemini") return callGemini(apiKey);
  if (state.provider === "claude") return callClaude(apiKey);
  throw new Error("Unknown provider.");
}

async function callCloudflare() {
  const response = await fetch(workerEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image: {
        mimeType: state.image.mimeType,
        base64: state.image.base64,
      },
      context: els.contextInput.value.trim(),
      model: els.modelInput.value.trim() || defaults.cloudflare,
    }),
  });

  const payload = await parseApiResponse(response);
  return payload.result || payload;
}

function workerEndpoint() {
  return els.endpointInput.value.trim();
}

async function callGemini(apiKey) {
  const model = encodeURIComponent(els.modelInput.value.trim() || defaults.gemini);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: promptText() },
            {
              inline_data: {
                mime_type: state.image.mimeType,
                data: state.image.base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.1,
      },
    }),
  });

  const payload = await parseApiResponse(response);
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  return parseJsonText(text);
}

async function callClaude(apiKey) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: els.modelInput.value.trim() || defaults.claude,
      max_tokens: 700,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: promptText() },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: state.image.mimeType,
                data: state.image.base64,
              },
            },
          ],
        },
      ],
    }),
  });

  const payload = await parseApiResponse(response);
  const text = payload.content?.map((part) => part.text || "").join("") || "";
  return parseJsonText(text);
}

function promptText() {
  const context = els.contextInput.value.trim();
  return `${systemPrompt}\n\nUser context: ${context || "none provided"}`;
}

async function parseApiResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload.error?.message || payload.message || payload.raw || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload;
}

function parseJsonText(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("The model did not return JSON. Try again or use a different model.");
  }
}

function demoResult() {
  const context = els.contextInput.value.toLowerCase();
  const risky = ["wild", "mushroom", "medicine", "chemical", "unknown", "foraged", "spoiled", "mold"].some((word) => context.includes(word));
  if (risky) {
    return {
      verdict: "avoid",
      item: "Unverified high-risk item",
      confidence: "medium",
      summary: "Do not eat this without expert verification because the context suggests a high-risk item.",
      watchouts: ["Wild or unknown items can have dangerous lookalikes.", "Images cannot confirm toxins, contamination, or freshness."],
    };
  }
  return {
    verdict: "caution",
    item: "Possible food item",
    confidence: "low",
    summary: "This looks like something that may be food, but the demo engine cannot verify safety from the image.",
    watchouts: ["Use Free, Gemini, or Claude for real visual analysis.", "Check allergens, spoilage, storage time, and packaging before eating."],
  };
}

function normalizeResult(result) {
  const verdict = String(result.verdict || "caution").toLowerCase();
  return {
    verdict: ["safe", "caution", "avoid"].includes(verdict) ? verdict : "caution",
    item: result.item || "Unidentified item",
    confidence: result.confidence || "low",
    summary: result.summary || "The model returned a limited result.",
    watchouts: Array.isArray(result.watchouts) && result.watchouts.length ? result.watchouts : ["Do not rely on image analysis alone for medical, allergy, spoilage, or toxicology decisions."],
  };
}

function renderResult(result) {
  const titles = {
    safe: "Likely edible",
    caution: "Use caution",
    avoid: "Do not eat",
  };
  els.verdictDot.className = `verdict-dot ${result.verdict}`;
  els.verdictTitle.textContent = titles[result.verdict];
  els.summaryText.textContent = result.summary;
  els.identityText.textContent = result.item;
  els.confidenceText.textContent = String(result.confidence).toUpperCase();
  renderWatchouts(result.watchouts);
}

function renderWatchouts(items) {
  els.watchoutsList.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    return li;
  }));
}

function setPending(title, summary) {
  els.verdictDot.className = "verdict-dot pending";
  els.verdictTitle.textContent = title;
  els.summaryText.textContent = summary;
}

function setError(title, summary) {
  els.verdictDot.className = "verdict-dot avoid";
  els.verdictTitle.textContent = title;
  els.summaryText.textContent = summary;
}

function readableError(error) {
  if (!error) return "Unknown error.";
  if (error.name === "NotAllowedError") return "Camera permission was blocked.";
  return error.message || String(error);
}

init();
