# Vercel Production Setup for Google Auth

Your webapp is hosted at: **https://shikshaq.vercel.app**

## Required Configuration Changes

### 1. Supabase Dashboard Settings

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Settings** → **Auth**
4. Update the following:

   **Site URL:**
   ```
   https://shikshaq.vercel.app
   ```

   **Redirect URLs** (add both):
   ```
   https://shikshaq.vercel.app/**
   http://localhost:8080/**
   ```
   (The second one is for local development)

5. Click **Save**

### 2. Google Cloud Console (Already Done)

✅ You should already have this configured:
- **Authorized redirect URI**: `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
- (Replace `YOUR_PROJECT_REF` with your actual Supabase project reference)

**Important**: You do NOT need to add `https://shikshaq.vercel.app` directly to Google Cloud Console. The flow works like this:
1. User clicks "Sign in with Google" on your Vercel site
2. Redirects to Google for authentication
3. Google redirects to Supabase callback URL
4. Supabase processes the auth and redirects back to your Vercel site (using the Site URL/Redirect URLs you configured)

### 3. Code Configuration

✅ The code is already configured correctly:
- Uses `window.location.origin` which automatically detects the current URL
- Works for both `localhost:8080` (dev) and `shikshaq.vercel.app` (production)

## Testing

1. **Test on Production**:
   - Go to `https://shikshaq.vercel.app/auth`
   - Click "Continue with Google"
   - Should redirect to Google, then back to your Vercel site

2. **Test Locally** (if needed):
   - Temporarily change Supabase Site URL to `http://localhost:8080`
   - Test locally
   - Change it back to `https://shikshaq.vercel.app` when done

## Troubleshooting

### Issue: Redirect goes to wrong URL after Google auth

**Solution**: 
- Check Supabase Dashboard → Settings → Auth → Site URL is set to `https://shikshaq.vercel.app`
- Check Redirect URLs includes `https://shikshaq.vercel.app/**`

### Issue: "redirect_uri_mismatch" error

**Solution**:
- This should NOT happen if you only have the Supabase callback URL in Google Cloud Console
- Make sure you haven't added `https://shikshaq.vercel.app` directly to Google Cloud Console redirect URIs

### Issue: Auth works but user isn't logged in

**Solution**:
- Check browser console for errors
- Verify the OAuth callback handling code is working (should be automatic)
- Check Supabase Dashboard → Authentication → Logs for any errors

## Summary

✅ **Supabase Site URL**: `https://shikshaq.vercel.app`
✅ **Supabase Redirect URLs**: `https://shikshaq.vercel.app/**`
✅ **Google Cloud Console**: Only needs Supabase callback URL
✅ **Code**: Already configured correctly

That's it! Your Google auth should work on Vercel now.

