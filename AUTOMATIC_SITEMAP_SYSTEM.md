# AUTOMATIC SITEMAP GENERATION SYSTEM

**Status:** ✅ Ready to Deploy
**Last Updated:** March 15, 2026

---

## OVERVIEW

This system **automatically regenerates `public/sitemap.xml`** with ALL teacher profiles, subject pages, board pages, and static pages every time you build the site.

### What It Does

1. ✅ **Queries Supabase** for all approved teachers
2. ✅ **Generates sitemap entries** for each teacher profile URL
3. ✅ **Includes all subject and board pages**
4. ✅ **Includes all static pages** (home, browse, FAQ, etc.)
5. ✅ **Updates `public/sitemap.xml` automatically**
6. ✅ **Runs before every build** (via `prebuild` script)

### How It Works

```
┌─────────────────────┐
│  npm run build      │
│  (or deploy)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  prebuild script    │
│  runs automatically │
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────┐
│  npm run generate-sitemap        │
│  (tsx scripts/generate-sitemap)  │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  1. Connect to Supabase          │
│  2. Query teachers_list table    │
│  3. Get all approved teachers    │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Generate sitemap XML with:      │
│  • 9 static pages                │
│  • 28 subject pages              │
│  • 5 board pages                 │
│  • N teacher profiles (dynamic)  │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Write to public/sitemap.xml     │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Build continues normally        │
│  (vite build)                    │
└──────────────────────────────────┘
```

---

## FILES CREATED

### 1. Sitemap Generation Script
**Path:** `scripts/generate-sitemap.ts`
**Size:** ~7 KB
**Purpose:** Queries database and generates sitemap XML

### 2. Updated package.json
**Changes:**
- Added `"generate-sitemap": "tsx scripts/generate-sitemap.ts"` script
- Added `"prebuild": "npm run generate-sitemap"` hook
- Installed `tsx` dev dependency for running TypeScript scripts

### 3. Auto-Generated Sitemap
**Path:** `public/sitemap.xml`
**Updates:** Automatically on every build
**Size:** ~8-20 KB (depending on teacher count)

---

## SETUP INSTRUCTIONS

### Step 1: Ensure Environment Variables

Create `.env` file in project root if not exists:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key-here
```

These should already exist since the site uses Supabase.

### Step 2: Test Manually

```bash
npm run generate-sitemap
```

Expected output:
```
🚀 Starting sitemap generation...

📡 Fetching teacher data from Supabase...
✅ Found 45 approved teachers

📊 Sitemap Statistics:
   Static pages:       9
   Subject pages:      28
   Board pages:        5
   Teacher profiles:   45
   ─────────────────────────────────
   Total URLs:         87

✅ Sitemap generated successfully!
   Output: C:\Users\kanis\Shikshaq\public\sitemap.xml
   Size: 15.23 KB

🎉 Done!
```

### Step 3: Verify Sitemap Content

```bash
# View sitemap
cat public/sitemap.xml | head -50

# Or open in browser
start public/sitemap.xml
```

Expected structure:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ...>
  <url>
    <loc>https://www.shikshaq.in/</loc>
    <lastmod>2026-03-15</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://www.shikshaq.in/tuition-teachers/jaya-sonthalia</loc>
    <lastmod>2026-03-10</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <!-- ... more teacher profiles ... -->
</urlset>
```

### Step 4: Test Build Process

```bash
npm run build
```

Expected behavior:
1. `prebuild` runs first
2. Sitemap is regenerated
3. Build proceeds normally
4. Sitemap is included in `dist/` folder

### Step 5: Deploy

When you deploy to production (Vercel/Netlify/etc.), the sitemap will automatically regenerate on every deployment.

---

## HOW IT AUTOMATICALLY UPDATES

### On Every Build

```bash
npm run build
# ↓ triggers prebuild
# ↓ runs generate-sitemap
# ↓ queries database
# ↓ updates sitemap.xml
# ↓ continues build
```

### When Teachers Are Added

1. Admin approves new teacher in database
2. Next deployment automatically includes new teacher in sitemap
3. No manual intervention needed

### When Teachers Are Removed

1. Teacher is unapproved or deleted from database
2. Next build excludes that teacher from sitemap
3. Sitemap stays in sync with database

---

## MANUAL REGENERATION (Optional)

If you want to regenerate sitemap without building:

```bash
npm run generate-sitemap
```

Then commit the updated `public/sitemap.xml`:

```bash
git add public/sitemap.xml
git commit -m "Update sitemap with latest teachers"
git push
```

---

## SITEMAP CONTENTS

### Static Pages (9 total)

| URL | Priority | Update Freq |
|-----|----------|-------------|
| `/` | 1.0 | daily |
| `/all-tuition-teachers-in-kolkata` | 0.9 | daily |
| `/faq` | 0.6 | monthly |
| `/join` | 0.7 | monthly |
| `/join/apply` | 0.6 | monthly |
| `/past-papers` | 0.5 | weekly |
| `/privacy-policy` | 0.3 | yearly |
| `/terms-of-service` | 0.3 | yearly |
| `/recommend-teacher` | 0.5 | monthly |

### Subject Pages (28 total)

All follow pattern: `/[subject]-tuition-teachers-in-kolkata`

Priority: 0.6-0.8 | Update Freq: weekly

Examples:
- `/maths-tuition-teachers-in-kolkata`
- `/physics-tuition-teachers-in-kolkata`
- `/english-tuition-teachers-in-kolkata`
- `/sat-tuition-teachers-in-kolkata`
- etc.

### Board Pages (5 total)

All follow pattern: `/[board]-tuition-teachers-in-kolkata`

Priority: 0.7-0.8 | Update Freq: weekly

Examples:
- `/cbse-tuition-teachers-in-kolkata`
- `/icse-tuition-teachers-in-kolkata`
- `/igcse-tuition-teachers-in-kolkata`
- etc.

### Teacher Profiles (Dynamic)

Pattern: `/tuition-teachers/[slug]`

Priority: 0.7 | Update Freq: weekly

Examples:
- `/tuition-teachers/jaya-sonthalia`
- `/tuition-teachers/jasmine-choreria`
- `/tuition-teachers/swati-dutta`
- etc.

**Count:** Automatically matches number of approved teachers in database

---

## DATABASE QUERY

The script queries Supabase like this:

```typescript
const { data: teachers } = await supabase
  .from('teachers_list')
  .select('slug, updated_at')
  .eq('approved', true)
  .order('updated_at', { ascending: false });
```

### Required Table Structure

**Table:** `teachers_list`

**Required Columns:**
- `slug` (text) - URL slug for teacher profile
- `updated_at` (timestamp) - Last modified date
- `approved` (boolean) - Approval status

---

## TROUBLESHOOTING

### Issue: "Missing Supabase credentials"

**Solution:**
```bash
# Create .env file
echo "VITE_SUPABASE_URL=https://your-project.supabase.co" >> .env
echo "VITE_SUPABASE_PUBLISHABLE_KEY=your-key" >> .env
```

### Issue: "No approved teachers found"

**Possible causes:**
1. No teachers in database yet
2. All teachers have `approved = false`
3. Wrong table name

**Debug:**
```sql
-- Run in Supabase SQL editor
SELECT COUNT(*) FROM teachers_list WHERE approved = true;
```

### Issue: Sitemap not updating on build

**Check:**
```bash
# Verify prebuild script exists
npm run prebuild

# Should output sitemap generation logs
```

### Issue: Sitemap size too large

If sitemap exceeds 50 MB or 50,000 URLs, implement sitemap index.

**Current limit:** 50,000 URLs (very unlikely to hit)

---

## GOOGLE SEARCH CONSOLE

### Step 1: Remove Old Sitemap

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Select property: `www.shikshaq.in`
3. Navigate to **Sitemaps**
4. If old sitemap exists, delete it

### Step 2: Submit New Sitemap

1. Click **Add a new sitemap**
2. Enter: `sitemap.xml`
3. Click **Submit**

### Step 3: Monitor Indexing

Google will crawl the sitemap within 24-48 hours.

Monitor:
- **Discovered:** How many URLs Google found
- **Indexed:** How many are in Google's index

Expected timeline:
- Week 1-2: 20-50 teacher pages indexed
- Week 3-4: 50-100 teacher pages indexed
- Month 2-3: All teacher pages indexed

---

## SCHEDULED REGENERATION (Optional)

If you want sitemap to update without deployments:

### Option 1: GitHub Actions

Create `.github/workflows/sitemap.yml`:

```yaml
name: Update Sitemap
on:
  schedule:
    - cron: '0 2 * * *' # Daily at 2 AM
  workflow_dispatch: # Manual trigger

jobs:
  update-sitemap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run generate-sitemap
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
      - uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: "chore: auto-update sitemap"
          file_pattern: public/sitemap.xml
```

### Option 2: Vercel Cron (if deployed on Vercel)

Create `api/sitemap-cron.ts` using existing sitemap generator logic.

---

## PERFORMANCE

### Current Stats

- **Generation time:** ~1-2 seconds
- **File size:** ~8-20 KB (depending on teacher count)
- **Database query:** 1 query for all teachers
- **Memory usage:** Minimal

### Scalability

- ✅ **Up to 1,000 teachers:** No issues
- ✅ **Up to 10,000 teachers:** No issues
- ⚠️ **50,000+ teachers:** Consider sitemap index

---

## MONITORING

### Weekly Checks

```bash
# Check sitemap size
ls -lh public/sitemap.xml

# Count URLs
grep -o '<url>' public/sitemap.xml | wc -l

# Check last modified
head -20 public/sitemap.xml
```

### Google Search Console Metrics

Track weekly:
- **Coverage:** # of indexed pages
- **Sitemaps:** # of discovered/indexed URLs
- **Enhancement:** Structured data validation

---

## NEXT STEPS

1. ✅ **Test locally** - Run `npm run generate-sitemap`
2. ✅ **Verify output** - Check `public/sitemap.xml` content
3. ✅ **Test build** - Run `npm run build`
4. ✅ **Deploy** - Push to production
5. ✅ **Submit to Google** - Update Google Search Console
6. ⏳ **Monitor** - Check indexing progress over 2-4 weeks

---

## BENEFITS

### Before This System

- ❌ Manual sitemap updates required
- ❌ Teacher profiles NOT in sitemap
- ❌ Sitemap gets out of sync with database
- ❌ New teachers not discovered by Google

### After This System

- ✅ Automatic sitemap updates
- ✅ ALL teacher profiles included
- ✅ Sitemap always in sync with database
- ✅ New teachers indexed within days
- ✅ Zero maintenance required

---

## COMPARISON: STATIC vs DYNAMIC SITEMAP

| Feature | Static Sitemap | Dynamic Sitemap |
|---------|---------------|-----------------|
| Teacher profiles | ❌ Manual | ✅ Automatic |
| New teachers | ❌ Requires edit | ✅ Auto-added |
| Maintenance | ❌ Manual | ✅ Zero |
| Accuracy | ⚠️ Gets outdated | ✅ Always current |
| Build integration | ❌ None | ✅ Automatic |
| Database sync | ❌ No | ✅ Yes |

---

## CHANGELOG

### Version 1.0 (March 15, 2026)

- ✅ Created automatic sitemap generator
- ✅ Integrated with build process
- ✅ Added teacher profile URLs
- ✅ Included subject and board pages
- ✅ Set up prebuild hook
- ✅ Installed tsx dependency

---

## SUPPORT

For issues or questions:

- **Technical issues:** Check troubleshooting section above
- **Database access:** Verify .env credentials
- **Sitemap errors:** Validate at https://www.xml-sitemaps.com/validate-xml-sitemap.html

---

**Document Version:** 1.0
**Last Updated:** March 15, 2026
**Next Review:** After first deployment
