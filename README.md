# Can I Eat That?

Camera-first demo app that sends an image to Cloudflare Workers AI, Gemini, or Claude and returns a cautious edible / caution / avoid verdict.

## Run locally

```bash
npm run dev
```

Open `http://localhost:5173`.

## Demo flow

1. Choose `Free`, `Gemini`, or `Claude`.
2. For `Free`, use the deployed Cloudflare Worker endpoint. For Gemini or Claude, paste an API key.
3. Take a camera photo or upload an image.
4. Add optional context like cooked/raw, storage date, location, or allergy concerns.
5. Click `Analyze`.

`Demo` mode works without a key or Worker endpoint, but it is only a UI walkthrough and does not perform visual recognition.

## Cloudflare Workers AI

The free hosted route uses Cloudflare Workers AI with `@cf/meta/llama-3.2-11b-vision-instruct`.

```bash
npm run deploy:worker
npm run cf:agree
```

Cloudflare currently provides 10,000 Workers AI Neurons per day at no charge. The app resizes uploaded images before sending them to the Worker to keep usage predictable.

## Deployment

The browser app is static, so it can be deployed to GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any HTTPS static host. Camera capture works best on `https://` or `localhost`.

For a public production deployment, keep shared model credentials in the Worker or another serverless function. Direct Gemini and Claude browser calls are useful for demos where the user supplies their own key.

## Safety note

The app is intentionally conservative. Image analysis cannot verify allergens, spoilage, contamination, toxins, dosage, or poisonous lookalikes. It should not be used as medical, toxicology, or wilderness-foraging advice.
