# Localhost Authentication Setup

## Problem
After signing in on localhost, you're being redirected to the Vercel app instead of staying on localhost.

## Solution: Configure Supabase for Local Development

### Step 1: Update Supabase Site URL (for local testing)

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **URL Configuration**
3. Set **Site URL** to: `http://localhost:8080`
4. Click **Save**

### Step 2: Add Localhost to Redirect URLs

1. In the same **URL Configuration** section
2. Under **Redirect URLs**, add:
   ```
   http://localhost:8080/**
   ```
3. Make sure you also keep your Vercel URL:
   ```
   https://shikshaq.vercel.app/**
   ```
4. Click **Save**

### Step 3: Verify Your Local Server

Make sure your local development server is running on port 8080:
```bash
npm run dev
# Should start on http://localhost:8080
```

## Quick Switch Between Localhost and Production

### For Local Development:
- **Site URL**: `http://localhost:8080`
- **Redirect URLs**: 
  - `http://localhost:8080/**`
  - `https://shikshaq.vercel.app/**` (keep for production)

### For Production (Vercel):
- **Site URL**: `https://shikshaq.vercel.app`
- **Redirect URLs**: 
  - `http://localhost:8080/**` (keep for local testing)
  - `https://shikshaq.vercel.app/**`

## Why This Happens

Supabase uses the **Site URL** as the default redirect destination after authentication. If it's set to your Vercel URL, even when testing locally, Supabase will redirect to Vercel.

The code uses `window.location.origin` which correctly detects localhost, but Supabase's Site URL setting overrides this behavior.

## Testing

After updating the settings:
1. Clear your browser cache/cookies for localhost
2. Restart your local dev server
3. Try signing in again - you should stay on `http://localhost:8080`

