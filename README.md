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

The client is prepared in `src/lib/supabase.ts`. Current app data still uses local browser storage until the database schema and sync flow are added.
