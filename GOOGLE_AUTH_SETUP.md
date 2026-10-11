# Google Authentication Setup Guide

## Why Google Auth Might Not Be Working

Common issues:
1. Google OAuth not enabled in Supabase
2. Missing or incorrect Google OAuth credentials
3. Wrong redirect URLs configured
4. Google Cloud Console not properly set up

## Step-by-Step Setup

### Step 1: Get Your Supabase Project URL

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Settings** → **API**
4. Copy your **Project URL** (looks like: `https://xxxxxxxxxxxxx.supabase.co`)

### Step 2: Set Up Google OAuth in Google Cloud Console

1. **Go to [Google Cloud Console](https://console.cloud.google.com/)**
2. **Create or Select a Project**
   - Click the project dropdown at the top
   - Click "New Project" or select an existing one

3. **Enable Google+ API**
   - Go to "APIs & Services" → "Library"
   - Search for "Google+ API" or "Google Identity"
   - Click "Enable"

4. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - If prompted, configure the OAuth consent screen first:
     - User Type: External (unless you have Google Workspace)
     - App name: ShikshAq (or your app name)
     - User support email: Your email
     - Developer contact: Your email
     - Click "Save and Continue" through the steps

5. **Create OAuth Client ID**
   - Application type: **Web application**
   - Name: ShikshAq (or any name)
   - **Authorized redirect URIs**: Add these URLs:
     ```
     https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
     ```
     Replace `YOUR_PROJECT_REF` with your actual Supabase project reference
     - **Note**: Only add the Supabase callback URL here. Do NOT add your Vercel URL directly.
   - Click "Create"
   - **Copy the Client ID and Client Secret** (you'll need these)

### Step 3: Configure Google OAuth in Supabase

1. **Go to Supabase Dashboard**
   - Navigate to your project
   - Go to **Authentication** → **Providers**

2. **Enable Google Provider**
   - Find "Google" in the list
   - Toggle it to **Enabled**

3. **Add Credentials**
   - Paste your **Client ID** from Google Cloud Console
   - Paste your **Client Secret** from Google Cloud Console
   - Click "Save"

4. **Verify Redirect URL**
   - The redirect URL should be: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
   - This is automatically handled by Supabase

### Step 4: Configure Supabase for Production (Vercel)

1. **Go to Supabase Dashboard** → **Settings** → **Auth**
2. **Update Site URL**:
   - Set to: `https://shikshaq.vercel.app`
3. **Add Redirect URLs**:
   - Add: `https://shikshaq.vercel.app/**`
   - (Optional for local dev): `http://localhost:8080/**`
4. Click **Save**

**Important**: The Site URL tells Supabase where your app is hosted. The Redirect URLs allow Supabase to redirect back to your app after authentication.

### Step 5: Test the Setup

1. **Restart your dev server**:
   ```bash
   npm run dev
   ```

2. **Try signing in with Google**:
   - Go to `/auth` page
   - Click "Continue with Google"
   - You should be redirected to Google's sign-in page
   - After signing in, you should be redirected back to your app

## Troubleshooting

### Issue: "redirect_uri_mismatch" Error

**Solution**: Make sure the redirect URI in Google Cloud Console exactly matches:
```
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

### Issue: "OAuth client not found" Error

**Solution**: 
- Verify Client ID is correct in Supabase
- Make sure you copied the full Client ID (not truncated)

### Issue: Nothing happens when clicking "Continue with Google"

**Solution**:
- Check browser console for errors (F12)
- Verify Google provider is enabled in Supabase
- Check that Client ID and Secret are saved in Supabase

### Issue: Redirect goes to wrong URL or port

**Solution**:
1. Go to Supabase Dashboard → **Settings** → **Auth**
2. Scroll down to **Site URL** section
3. Update **Site URL**:
   - **For production**: `https://shikshaq.vercel.app`
   - **For local development**: `http://localhost:8080` (change when testing locally)
4. In **Redirect URLs**, add:
   - `https://shikshaq.vercel.app/**` (for production)
   - `http://localhost:8080/**` (for local dev - optional)
5. Click **Save**
6. The redirect URL in the code uses `window.location.origin`, so it should automatically match your current URL, but Supabase's Site URL setting is the primary configuration

### Issue: "Access blocked: This app's request is invalid"

**Solution**:
- Make sure OAuth consent screen is configured in Google Cloud Console
- Add your email to test users if the app is in testing mode
- Publish the app or add test users in OAuth consent screen

## Quick Checklist

- [ ] Google Cloud project created
- [ ] Google+ API enabled
- [ ] OAuth consent screen configured
- [ ] OAuth 2.0 Client ID created
- [ ] Redirect URI added in Google Cloud Console
- [ ] Google provider enabled in Supabase
- [ ] Client ID and Secret added to Supabase
- [ ] Dev server restarted

## Need Help?

If you're still having issues:
1. Check the browser console (F12) for specific error messages
2. Check Supabase Dashboard → Authentication → Logs for auth errors
3. Verify your Supabase project URL matches in both places

