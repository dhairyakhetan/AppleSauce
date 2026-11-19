# Setting Up Vercel Environment Variables

## Required Environment Variables

Your app needs these two environment variables to connect to Supabase:

1. `VITE_SUPABASE_URL`
2. `VITE_SUPABASE_PUBLISHABLE_KEY`

## Step-by-Step Setup

### Step 1: Get Your Supabase Credentials

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Settings** → **API**
4. You'll see:
   - **Project URL** (this is your `VITE_SUPABASE_URL`)
   - **Project API keys** → **anon** `public` key (this is your `VITE_SUPABASE_PUBLISHABLE_KEY`)

**Example:**
- Project URL: `https://uvtifolnsneitetzohtn.supabase.co`
- anon public key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (long string)

### Step 2: Add Environment Variables to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project: **shikshaq**
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**

#### Add First Variable:
- **Name**: `VITE_SUPABASE_URL`
- **Value**: `https://uvtifolnsneitetzohtn.supabase.co` (your Supabase Project URL)
- **Environment**: Select all (Production, Preview, Development)
- Click **Save**

#### Add Second Variable:
- **Name**: `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Value**: (paste your anon public key from Supabase)
- **Environment**: Select all (Production, Preview, Development)
- Click **Save**

### Step 3: Redeploy Your Application

After adding environment variables, you **must redeploy** for them to take effect:

1. Go to **Deployments** tab in Vercel
2. Click the **three dots** (⋯) on the latest deployment
3. Click **Redeploy**
4. Or push a new commit to trigger a new deployment

**Important**: Environment variables are only available after redeployment!

## Verification

After redeploying, verify the variables are working:

1. Go to your deployed site: `https://shikshaq.vercel.app`
2. Open browser console (F12)
3. Check for any errors about missing environment variables
4. Try signing in with Google - it should work now!

## Security Notes

✅ **Safe to use in client-side code:**
- `VITE_SUPABASE_URL` - Public, safe to expose
- `VITE_SUPABASE_PUBLISHABLE_KEY` - This is the "anon" key, designed for client-side use

❌ **Never expose these:**
- Service role key (starts with `eyJ...` but different from anon key)
- Any keys marked as "secret" or "service_role"

## Troubleshooting

### Variables Not Working After Adding

1. **Did you redeploy?** - Variables only work after redeployment
2. **Check variable names** - Must be exactly: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
3. **Check environments** - Make sure variables are enabled for Production
4. **Check for typos** - Copy-paste from Supabase to avoid errors

### Still Getting Errors

1. Check Vercel deployment logs:
   - Go to Deployments → Click on latest deployment → View logs
   - Look for errors about missing environment variables

2. Verify in Supabase:
   - Make sure you're using the **anon public** key, not the service role key
   - The key should be very long (hundreds of characters)

3. Test locally:
   - Create a `.env` file in your project root:
     ```
     VITE_SUPABASE_URL=https://uvtifolnsneitetzohtn.supabase.co
     VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here
     ```
   - Test locally to make sure it works
   - Then add the same values to Vercel

## Quick Checklist

- [ ] Got Supabase Project URL from Settings → API
- [ ] Got Supabase anon public key from Settings → API
- [ ] Added `VITE_SUPABASE_URL` to Vercel
- [ ] Added `VITE_SUPABASE_PUBLISHABLE_KEY` to Vercel
- [ ] Selected all environments (Production, Preview, Development)
- [ ] Redeployed the application
- [ ] Tested OAuth sign-in on production

Once you've added these and redeployed, your OAuth should work!

