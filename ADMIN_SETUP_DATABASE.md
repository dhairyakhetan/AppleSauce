# Database-Based Admin Setup

## Overview

The admin panel now uses database-based authentication instead of a password. Only users whose IDs are in the `admins` table can access the admin panel.

## Step 1: Run the Migration

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Copy and paste the contents of `supabase/migrations/20250121000002_create_admins_table.sql`
3. Click **Run**

This creates the `admins` table with proper RLS policies.

## Step 2: Add Your User ID to Admins Table

You need to add your user ID to the `admins` table. Here's how:

### Option A: Via Supabase Dashboard (Easiest)

1. Go to **Supabase Dashboard** → **Authentication** → **Users**
2. Find your user account
3. Copy your **User UID** (it's a UUID like `bc51ada2-0c2c-4f21-a1f8-bc3db1f179bb`)
4. Go to **Table Editor** → **admins**
5. Click **Insert row**
6. Paste your User UID in the `id` field
7. Click **Save**

### Option B: Via SQL Editor

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Run this query (replace `YOUR_USER_ID` with your actual user ID):

```sql
INSERT INTO public.admins (id) 
VALUES ('YOUR_USER_ID_HERE');
```

**To find your User ID:**
- Go to **Authentication** → **Users**
- Click on your user
- Copy the **User UID**

## Step 3: Verify It Works

1. Make sure you're signed in to your website
2. Visit `/admin/recommendations`
3. You should now have access to the admin panel

## Adding More Admins

To add more admin users:

1. Get their user ID from **Authentication** → **Users**
2. Add it to the `admins` table (via Table Editor or SQL)
3. They'll immediately have admin access

## Removing Admins

To remove admin access:

1. Go to **Table Editor** → **admins**
2. Find the user's row
3. Delete it
4. They'll immediately lose admin access

## Security Notes

- ✅ Only users in the `admins` table can access the admin panel
- ✅ RLS policies protect the `admins` table
- ✅ No passwords to manage or expose
- ✅ Easy to add/remove admins
- ✅ Works on both localhost and Vercel

## Troubleshooting

**"Access Denied" even after adding user ID:**
- Make sure you're signed in with the correct account
- Verify the user ID is correct (check for typos)
- Check that the migration ran successfully
- Try signing out and signing back in

**"Sign In Required":**
- You need to be signed in to access the admin panel
- Sign in first, then visit `/admin/recommendations`

**Table doesn't exist:**
- Make sure you ran the migration
- Check **Table Editor** to see if `admins` table exists

