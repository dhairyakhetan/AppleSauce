# Understanding Supabase API Keys

## Key Types in Supabase

Supabase provides different API keys with different names depending on where you look:

### 1. **anon key** (also called "public" or "publishable")
- **Location**: Supabase Dashboard → Settings → API → Project API keys → **anon** `public`
- **Purpose**: Client-side authentication and data access
- **Safety**: ✅ **SAFE** to expose in client-side code
- **What it can do**: Only what your Row Level Security (RLS) policies allow
- **Where to use**: Browser/client-side applications (like your React app)

### 2. **service_role key** (also called "secret")
- **Location**: Supabase Dashboard → Settings → API → Project API keys → **service_role** `secret`
- **Purpose**: Server-side operations with full database access
- **Safety**: ❌ **NEVER** expose in client-side code
- **What it can do**: Bypasses all RLS policies - full database access
- **Where to use**: Server-side only (backend, serverless functions)

## Which Key to Use

For your Vercel deployment, use the **anon/public/publishable** key:

1. Go to Supabase Dashboard → Settings → API
2. Under "Project API keys", you'll see:
   - **anon** `public` ← **Use this one** ✅
   - **service_role** `secret` ← **Never use this** ❌

## Why the "anon" Key is Safe

### 1. Designed for Client-Side
- Supabase specifically created this key for use in browser/client applications
- It's called "anon" because it represents an anonymous/unauthenticated user
- Once a user authenticates, their permissions are still restricted by RLS

### 2. Protected by Row Level Security (RLS)
- RLS policies control what data can be accessed
- Even with the key, users can only access data your policies allow
- Example: Users can only see their own liked teachers (your RLS policy enforces this)

### 3. Limited Permissions
- Cannot bypass RLS policies
- Cannot access service_role operations
- Cannot modify database structure
- Can only perform operations your RLS policies permit

### 4. Already Public
- Since you're using `VITE_` prefix, this key gets bundled into your JavaScript
- Anyone can view it in the browser's developer tools
- This is expected and safe behavior

## How to Verify You Have the Right Key

### In Supabase Dashboard:
1. Go to **Settings** → **API**
2. Look for **Project API keys** section
3. You should see:
   ```
   anon public
   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dGlmb2xuc25laXRldHpvaHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTY3NDUzNjEsImV4cCI6MjAzMjMyMTM2MX0...
   ```
   - Notice: `"role":"anon"` in the decoded JWT
   - This is the safe one ✅

4. You'll also see:
   ```
   service_role secret
   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dGlmb2xuc25laXRldHpvaHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxNjc0NTM2MSwiZXhwIjoyMDMyMzIxMzYxfQ...
   ```
   - Notice: `"role":"service_role"` in the decoded JWT
   - This is the dangerous one ❌

## What Happens If You Use the Wrong Key

### Using service_role in client-side:
- ❌ Bypasses all security
- ❌ Users can access/modify any data
- ❌ Major security vulnerability
- ❌ Supabase will warn you if detected

### Using anon/public in client-side:
- ✅ Respects RLS policies
- ✅ Users can only access permitted data
- ✅ Secure and recommended
- ✅ This is what you should use

## Your Code Already Uses the Right Key

Looking at your code:
```typescript
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
```

The variable name "PUBLISHABLE_KEY" indicates it's meant to be public. This is correct!

## Summary

✅ **YES, the publishable/anon/public key is SAFE** to add to Vercel
- It's designed to be public
- Protected by RLS policies
- Already exposed in your client bundle
- This is the correct key to use

❌ **NEVER use the service_role/secret key** in client-side code
- It has full database access
- Bypasses all security
- Only for server-side use

## Action Items

1. Go to Supabase → Settings → API
2. Copy the **anon** `public` key (the long string)
3. Add it to Vercel as `VITE_SUPABASE_PUBLISHABLE_KEY`
4. This is safe and correct ✅

