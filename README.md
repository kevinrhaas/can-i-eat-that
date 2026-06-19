# Can I Eat That?

Camera-first demo app that sends an image to either Gemini or Claude and returns a cautious edible / caution / avoid verdict.

## Run locally

```bash
npm run dev
```

Open `http://localhost:5173`.

## Demo flow

1. Choose `Gemini` or `Claude`.
2. Paste an API key.
3. Take a camera photo or upload an image.
4. Add optional context like cooked/raw, storage date, location, or allergy concerns.
5. Click `Analyze`.

`Demo` mode works without a key, but it is only a UI walkthrough and does not perform visual recognition.

## Deployment

This is a static app, so it can be deployed to GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any HTTPS static host. Camera capture works best on `https://` or `localhost`.

For a public production deployment, do not expose shared API keys in the browser. Move the Gemini or Claude calls into a serverless function and have the browser call your function instead.

## Safety note

The app is intentionally conservative. Image analysis cannot verify allergens, spoilage, contamination, toxins, dosage, or poisonous lookalikes. It should not be used as medical, toxicology, or wilderness-foraging advice.
