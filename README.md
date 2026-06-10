# RaceLog Pro

## Run Locally

**Prerequisite:** Node.js 20+

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   cp .env.example .env.local
   ```

3. Run the app:

   ```bash
   npm run dev
   ```

The app runs at `http://localhost:3000`.

## Vercel

Use the default Vercel settings for a Vite app:

- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

`vercel.json` includes the SPA rewrite needed for client-side navigation.

## Supabase

Add these environment variables in `.env.local` and in the Vercel project settings:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Create the shared app-state table before testing sync:

1. Open your Supabase project.
2. Go to `SQL Editor`.
3. Open `supabase/schema.sql` from this repo.
4. Paste the full SQL into Supabase.
5. Click `Run`.

The app syncs one shared row named `default` in `public.app_state`. Legs, stints, active race weekend, app colors, and uploaded logo are stored in that shared state, with local browser storage kept only as an offline fallback.

After changing Vercel environment variables or pushing sync changes, redeploy the latest Vercel deployment.
