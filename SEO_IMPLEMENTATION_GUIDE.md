# SHIKSHAQ SEO IMPLEMENTATION GUIDE

**Last Updated:** March 15, 2026
**Status:** Ready for Implementation
**Estimated Implementation Time:** 2-3 weeks

---

## TABLE OF CONTENTS

1. [Executive Summary](#executive-summary)
2. [Critical Issues Found](#critical-issues-found)
3. [Files Created](#files-created)
4. [Implementation Checklist](#implementation-checklist)
5. [Phase 1: Dynamic Sitemap (CRITICAL)](#phase-1-dynamic-sitemap-critical)
6. [Phase 2: SEO Head Component](#phase-2-seo-head-component)
7. [Phase 3: Structured Data](#phase-3-structured-data)
8. [Phase 4: Page-Specific Optimizations](#phase-4-page-specific-optimizations)
9. [Phase 5: Automation & Monitoring](#phase-5-automation--monitoring)
10. [Testing & Validation](#testing--validation)
11. [Expected Results](#expected-results)
12. [Maintenance Schedule](#maintenance-schedule)

---

## EXECUTIVE SUMMARY

### Current SEO Score: 5.3/10

The Shikshaq website has **solid foundational SEO** but suffers from critical gaps:

- ✅ Good structured data on homepage and teacher profiles
- ✅ Clean URL structure and proper robots.txt
- ❌ **NO teacher profiles in sitemap** (biggest issue)
- ❌ **NO canonical tags anywhere**
- ❌ **NO server-side rendering** (meta tags injected client-side)
- ❌ **Subject/board pages lack unique meta tags and structured data**

### Impact of Implementation

After full implementation, expected improvements:

- **+200-500%** increase in indexed teacher profile pages
- **+150-300%** increase in organic search traffic
- **+100%** improvement in subject page rankings
- **Better social media sharing** (proper OG images)
- **Reduced duplicate content issues**
- **Improved crawl efficiency**

---

## CRITICAL ISSUES FOUND

### 🔴 CRITICAL (Fix Immediately)

1. **Dynamic Sitemap Missing**
   - Teacher profiles (potentially 100+) NOT in sitemap
   - Search engines cannot discover individual teacher pages
   - Static sitemap requires manual updates

2. **No Canonical Tags**
   - Risk of duplicate content penalties
   - Filter URLs may compete with clean URLs
   - No canonical references across site

3. **Client-Side Meta Tag Injection**
   - Meta tags injected via JavaScript (useEffect)
   - Google may not index meta tags properly
   - Social media crawlers won't see OG tags

4. **Missing OG Images**
   - No og:image tags anywhere
   - Social shares show broken/no images
   - Lost social media traffic

---

## FILES CREATED

All new files are **patch-ready** and safe to add without breaking existing functionality.

### 1. Dynamic Sitemap Generator
**File:** `api/sitemap.ts`
**Purpose:** Automatically generates sitemap.xml with all teacher profiles
**Type:** Serverless function (Vercel/Netlify compatible)

### 2. SEO Head Component
**File:** `src/components/SEOHead.tsx`
**Purpose:** Reusable component for managing all meta tags, canonical URLs, and structured data
**Type:** React component

### 3. Structured Data Generators
**File:** `src/utils/structuredDataGenerators.ts`
**Purpose:** Helper functions for generating schema.org markup
**Type:** Utility module

### 4. FAQ Schema Component
**File:** `src/components/FAQSchema.tsx`
**Purpose:** Automatic FAQPage schema injection
**Type:** React component

### 5. Updated robots.txt
**File:** `public/robots.txt` (updated)
**Changes:** Added crawl delay, query param blocking, llms.txt reference

### 6. Updated llms.txt
**File:** `public/llms.txt` (updated)
**Changes:** Added AI crawler guidelines, privacy protection rules

---

## IMPLEMENTATION CHECKLIST

### Pre-Implementation (1 day)

- [ ] Backup current site and database
- [ ] Test in development environment first
- [ ] Review all created files
- [ ] Ensure Supabase credentials in env variables
- [ ] Install dependencies (if needed): `@supabase/supabase-js`

### Phase 1: Dynamic Sitemap (2-3 days) 🔴 CRITICAL

- [ ] Deploy `api/sitemap.ts` as serverless function
- [ ] Configure environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)
- [ ] Test sitemap generation: `https://www.shikshaq.in/api/sitemap`
- [ ] Verify teacher profiles appear in sitemap
- [ ] Submit new sitemap to Google Search Console
- [ ] Update robots.txt sitemap reference (if using `/api/sitemap.xml`)
- [ ] Set up automatic regeneration (daily cron job or on-demand)

### Phase 2: SEO Head Component (3-4 days) 🟡 HIGH

- [ ] Import SEOHead component into all pages
- [ ] Add to Homepage (Index.tsx)
- [ ] Add to Browse page (Browse.tsx)
- [ ] Add to Subject pages (SubjectPage.tsx)
- [ ] Add to Board pages (BoardPage.tsx)
- [ ] Add to Teacher profiles (TeacherProfile.tsx)
- [ ] Add to FAQ page
- [ ] Add to Privacy Policy, Terms of Service
- [ ] Create default OG image (1200x630px)
- [ ] Upload OG image to `/public/og-image-default.jpg`

### Phase 3: Structured Data (3-4 days) 🟡 HIGH

- [ ] Import `structuredDataGenerators.ts` utilities
- [ ] Add schema to Subject pages
- [ ] Add schema to Board pages
- [ ] Add schema to Browse page
- [ ] Add FAQSchema to FAQ page
- [ ] Test schemas in [Google Rich Results Test](https://search.google.com/test/rich-results)
- [ ] Fix any schema validation errors

### Phase 4: Page-Specific Meta Tags (3-5 days) 🟢 MEDIUM

#### Homepage
```tsx
<SEOHead
  title="Find Tuition Teachers in Kolkata"
  description="Shikshaq connects students with verified tuition teachers across CBSE, ICSE, IGCSE, IB. Free platform, no commission."
  canonical="/"
  ogImage="/og-image-home.jpg"
/>
```

#### Subject Pages (example: Maths)
```tsx
<SEOHead
  title="Maths Tuition Teachers in Kolkata"
  description="Find experienced maths tutors in Kolkata for CBSE, ICSE, IGCSE. Classes 1-12, JEE preparation. Free discovery platform."
  canonical="/maths-tuition-teachers-in-kolkata"
  ogImage="/og-image-maths.jpg"
  schema={generateSubjectPageSchemas({
    subject: 'Maths',
    url: '/maths-tuition-teachers-in-kolkata',
    description: '...',
    teacherCount: 45,
    breadcrumbs: [
      { name: 'Home', url: '/' },
      { name: 'Maths Tutors', url: '/maths-tuition-teachers-in-kolkata' }
    ]
  })}
/>
```

#### Board Pages (example: CBSE)
```tsx
<SEOHead
  title="CBSE Tuition Teachers in Kolkata"
  description="Find CBSE board tutors in Kolkata for all subjects and classes. Experienced teachers, verified profiles, free platform."
  canonical="/cbse-tuition-teachers-in-kolkata"
  schema={generateBoardPageSchemas({...})}
/>
```

#### Browse Page
```tsx
<SEOHead
  title="Browse All Tuition Teachers in Kolkata"
  description="Compare and find tuition teachers across subjects, boards, and localities in Kolkata. Filter by class, area, and mode."
  canonical="/all-tuition-teachers-in-kolkata"
  schema={generateBrowsePageSchemas({...})}
/>
```

#### Teacher Profiles
```tsx
// Already has dynamic meta tags - add SEOHead for canonical and OG image
<SEOHead
  canonical={`/tuition-teachers/${slug}`}
  ogImage={teacherImage || '/og-image-teacher.jpg'}
  // Keep existing title/description logic
/>
```

### Phase 5: OG Images (2-3 days) 🟢 MEDIUM

- [ ] Design default OG image (1200x630px)
- [ ] Create subject-specific OG images (optional)
- [ ] Upload to `/public/` folder
- [ ] Update SEOHead calls with ogImage prop
- [ ] Test social sharing on Facebook, LinkedIn, Twitter

### Phase 6: Automation (1-2 days) 🟢 LOW

- [ ] Set up sitemap regeneration schedule
- [ ] Configure cron job (daily at 2 AM IST): `0 2 * * *`
- [ ] Or use webhook trigger on teacher approval
- [ ] Monitor sitemap generation logs
- [ ] Set up Google Search Console alerts

---

## PHASE 1: DYNAMIC SITEMAP (CRITICAL)

### Step-by-Step Implementation

#### Step 1: Deploy Sitemap API

**For Vercel:**
1. Create `/api/sitemap.ts` (already created)
2. Deploy to Vercel
3. Access at: `https://www.shikshaq.in/api/sitemap`

**For Netlify:**
1. Rename to `netlify/functions/sitemap.ts`
2. Deploy to Netlify
3. Access at: `https://www.shikshaq.in/.netlify/functions/sitemap`

**For custom server:**
1. Create Express route:
```typescript
import { generateSitemap } from './api/sitemap';

app.get('/sitemap.xml', async (req, res) => {
  const xml = await generateSitemap();
  res.header('Content-Type', 'application/xml');
  res.send(xml);
});
```

#### Step 2: Environment Variables

Ensure these are set in your deployment platform:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

#### Step 3: Test Sitemap Generation

```bash
# Test locally (if using Node)
npm run build
node api/sitemap.ts

# Test deployed version
curl https://www.shikshaq.in/api/sitemap
```

Expected output:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
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

#### Step 4: Submit to Google Search Console

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Select property: `www.shikshaq.in`
3. Navigate to **Sitemaps** (left sidebar)
4. Remove old sitemap: `https://www.shikshaq.in/sitemap.xml`
5. Add new sitemap: `https://www.shikshaq.in/api/sitemap.xml`
6. Click **Submit**
7. Monitor indexing progress over next 7-14 days

#### Step 5: Automatic Regeneration

**Option A: Cron Job (Recommended)**
```bash
# Add to crontab (server)
0 2 * * * curl https://www.shikshaq.in/api/sitemap > /dev/null 2>&1
```

**Option B: Vercel Cron (Serverless)**
```json
// vercel.json
{
  "crons": [{
    "path": "/api/sitemap",
    "schedule": "0 2 * * *"
  }]
}
```

**Option C: Database Trigger (Advanced)**
When teacher is approved, trigger sitemap regeneration webhook.

---

## PHASE 2: SEO HEAD COMPONENT

### Implementation Example: Homepage

**File:** `src/pages/Index.tsx`

```tsx
import SEOHead from '@/components/SEOHead';

export default function Index() {
  return (
    <>
      <SEOHead
        title="Find Tuition Teachers in Kolkata - Shikshaq"
        description="Shikshaq connects students with verified tuition teachers across CBSE, ICSE, IGCSE, IB boards. Free peer-to-peer platform, no commission."
        canonical="/"
        ogImage="https://www.shikshaq.in/og-image-home.jpg"
        schema={[
          // Keep existing organization/service schemas from lines 84-182
        ]}
      />

      {/* Existing homepage content */}
    </>
  );
}
```

### Implementation Example: Subject Page

**File:** `src/pages/SubjectPage.tsx`

```tsx
import SEOHead from '@/components/SEOHead';
import { generateSubjectPageSchemas } from '@/utils/structuredDataGenerators';

export default function SubjectPage() {
  const subject = getSubjectFromURL(); // e.g., "Maths"
  const url = window.location.pathname;
  const teacherCount = getTeacherCount(); // Fetch from state/props

  return (
    <>
      <SEOHead
        title={`${subject} Tuition Teachers in Kolkata`}
        description={`Find experienced ${subject.toLowerCase()} tutors in Kolkata for CBSE, ICSE, IGCSE. All classes, verified profiles, free platform.`}
        canonical={url}
        ogImage={`https://www.shikshaq.in/og-image-${subject.toLowerCase()}.jpg`}
        schema={generateSubjectPageSchemas({
          subject,
          url,
          description: `...",
          teacherCount,
          breadcrumbs: [
            { name: 'Home', url: '/' },
            { name: `${subject} Tutors`, url }
          ]
        })}
      />

      {/* Existing Browse component */}
      <Browse initialFilters={{ subjects: [subject] }} />
    </>
  );
}
```

### Implementation Example: Teacher Profile

**File:** `src/pages/TeacherProfile.tsx`

```tsx
import SEOHead from '@/components/SEOHead';

export default function TeacherProfile() {
  const { slug } = useParams();
  const teacher = useTeacher(slug);

  // Keep existing meta tag logic (lines 451-545) OR replace with SEOHead

  return (
    <>
      <SEOHead
        // Title and description already generated dynamically
        canonical={`/tuition-teachers/${slug}`}
        ogImage={teacher.image_url || 'https://www.shikshaq.in/og-image-teacher.jpg'}
        // Keep existing schema generation
      />

      {/* Existing profile content */}
    </>
  );
}
```

---

## PHASE 3: STRUCTURED DATA

### Subject Page Schema Implementation

**Add to:** `src/pages/SubjectPage.tsx`

```tsx
import { generateSubjectPageSchemas, injectSchemas } from '@/utils/structuredDataGenerators';
import { useEffect } from 'react';

export default function SubjectPage() {
  const subject = 'Maths'; // Dynamic based on URL
  const teacherCount = 45; // Fetch from API/state

  useEffect(() => {
    const schemas = generateSubjectPageSchemas({
      subject,
      url: '/maths-tuition-teachers-in-kolkata',
      description: 'Find experienced maths tutors in Kolkata...',
      teacherCount,
      breadcrumbs: [
        { name: 'Home', url: '/' },
        { name: 'Maths Tutors', url: '/maths-tuition-teachers-in-kolkata' }
      ]
    });

    injectSchemas(schemas);
  }, [subject, teacherCount]);

  return (/* ... */);
}
```

### FAQ Page Schema Implementation

**Add to:** `src/pages/Index.tsx` (or wherever FAQ component is used)

```tsx
import FAQSchema from '@/components/FAQSchema';
import { FAQ } from '@/components/FAQ';

// Define FAQs (can also import from FAQ component)
const faqs = [
  {
    question: 'What is Shikshaq and how does it work?',
    answer: 'Shikshaq helps students find tuition teachers...'
  },
  // ... all FAQs
];

export default function Index() {
  return (
    <>
      <FAQSchema faqs={faqs} url="/faq" />
      <FAQ />
    </>
  );
}
```

---

## PHASE 4: PAGE-SPECIFIC OPTIMIZATIONS

### Meta Tag Requirements by Page Type

| Page Type | Title Format | Description Max Length | Priority |
|-----------|-------------|----------------------|----------|
| Homepage | "Find Tuition Teachers in Kolkata - Shikshaq" | 150 chars | 1.0 |
| Subject | "{Subject} Tuition Teachers in Kolkata" | 150 chars | 0.8 |
| Board | "{Board} Tuition Teachers in Kolkata" | 150 chars | 0.8 |
| Teacher | "{Name} teaches {Subjects} for Classes {Classes}" | 160 chars | 0.7 |
| Browse | "Browse All Tuition Teachers in Kolkata" | 150 chars | 0.9 |
| FAQ | "Frequently Asked Questions - Shikshaq" | 140 chars | 0.6 |

### Canonical URL Patterns

```
Homepage:           https://www.shikshaq.in/
Browse:             https://www.shikshaq.in/all-tuition-teachers-in-kolkata
Subject (Maths):    https://www.shikshaq.in/maths-tuition-teachers-in-kolkata
Board (CBSE):       https://www.shikshaq.in/cbse-tuition-teachers-in-kolkata
Teacher:            https://www.shikshaq.in/tuition-teachers/{slug}
FAQ:                https://www.shikshaq.in/faq
Privacy:            https://www.shikshaq.in/privacy-policy
Terms:              https://www.shikshaq.in/terms-of-service
```

**Important:** Always use canonical even if no query params present. This prevents future duplicate content issues.

---

## PHASE 5: AUTOMATION & MONITORING

### Sitemap Regeneration Schedule

**Recommended:** Daily at 2 AM IST (when traffic is lowest)

```bash
# Cron expression
0 2 * * *
```

**Trigger Conditions:**
- New teacher approved
- Teacher profile updated
- New subject added
- New board added

### Google Search Console Setup

1. **Add Property:** `www.shikshaq.in`
2. **Verify Ownership:** HTML tag method (already done: `LDwJgR1TPGyEfC0ha27ncvLL-FuvryEZBGFP-X0tmkI`)
3. **Submit Sitemap:** `https://www.shikshaq.in/api/sitemap.xml`
4. **Monitor:**
   - Coverage report (indexed pages)
   - Enhancement report (structured data)
   - Core Web Vitals

### Monitoring Checklist (Weekly)

- [ ] Check sitemap submission status
- [ ] Review indexed pages count (should increase to 100+)
- [ ] Check for crawl errors
- [ ] Validate structured data (no errors)
- [ ] Monitor Core Web Vitals
- [ ] Check average position for key queries

---

## TESTING & VALIDATION

### Pre-Launch Testing

#### 1. Sitemap Validation
```bash
# Test sitemap XML syntax
xmllint --noout https://www.shikshaq.in/api/sitemap.xml

# Check sitemap size
curl -I https://www.shikshaq.in/api/sitemap.xml
# Should be < 50MB
```

#### 2. Meta Tags Validation
Use [Meta Tags Checker](https://metatags.io/)

Test URLs:
- `https://www.shikshaq.in/`
- `https://www.shikshaq.in/maths-tuition-teachers-in-kolkata`
- `https://www.shikshaq.in/tuition-teachers/jaya-sonthalia`

Verify:
- ✅ Title tag present
- ✅ Meta description present
- ✅ Canonical URL present
- ✅ OG tags present (title, description, image, url)
- ✅ Twitter card tags present

#### 3. Structured Data Validation
Use [Google Rich Results Test](https://search.google.com/test/rich-results)

Test each page type:
- Homepage (Organization, LocalBusiness, Service)
- Subject page (CollectionPage, Service, Breadcrumb)
- Board page (CollectionPage, Service, Breadcrumb)
- Teacher profile (Person, Breadcrumb, Review)
- FAQ page (FAQPage)

Verify:
- ✅ 0 errors
- ✅ 0 warnings (or only minor warnings)
- ✅ All schemas recognized

#### 4. Social Media Preview Testing
**Facebook:** [Sharing Debugger](https://developers.facebook.com/tools/debug/)
**Twitter:** [Card Validator](https://cards-dev.twitter.com/validator)
**LinkedIn:** Share URL and check preview

Verify:
- ✅ Title displays correctly
- ✅ Description displays correctly
- ✅ Image displays (1200x630px)
- ✅ URL is correct

#### 5. Mobile-Friendliness
Use [Mobile-Friendly Test](https://search.google.com/test/mobile-friendly)

Verify:
- ✅ Page is mobile-friendly
- ✅ Text is readable
- ✅ Viewport configured
- ✅ No flash or incompatible plugins

### Post-Launch Monitoring (30 days)

| Metric | Baseline | Target | Check Frequency |
|--------|----------|--------|----------------|
| Indexed pages | ~50 | 150+ | Weekly |
| Organic traffic | 100% | 150-200% | Weekly |
| Avg. position (main keywords) | X | -5 to -10 | Weekly |
| Crawl errors | 0 | 0 | Weekly |
| Valid structured data items | ~50 | 150+ | Bi-weekly |
| Click-through rate | X% | +1-2% | Monthly |

---

## EXPECTED RESULTS

### Timeline

| Phase | Timeline | Key Metrics |
|-------|----------|-------------|
| Week 1-2 | Implementation | Files deployed, sitemap live |
| Week 3-4 | Indexing begins | +20-50 pages indexed |
| Week 5-8 | Acceleration | +50-100 pages indexed |
| Week 9-12 | Stabilization | +100-150 pages indexed |
| Month 4-6 | Full impact | Traffic +150-300% |

### SEO Score Improvement

| Category | Before | After | Change |
|----------|--------|-------|--------|
| robots.txt | 9/10 | 10/10 | +1 |
| sitemap.xml | 3/10 | 10/10 | +7 🔥 |
| Meta Tags | 5/10 | 9/10 | +4 |
| Canonical Tags | 0/10 | 10/10 | +10 🔥 |
| OpenGraph | 4/10 | 9/10 | +5 |
| Twitter Cards | 4/10 | 9/10 | +5 |
| Structured Data | 7/10 | 10/10 | +3 |
| Indexability | 4/10 | 9/10 | +5 🔥 |
| Internal Linking | 8/10 | 9/10 | +1 |
| URL Structure | 9/10 | 9/10 | 0 |
| **OVERALL** | **5.3/10** | **9.4/10** | **+4.1** |

### Traffic Projections

**Conservative Estimate (12 months):**
- Current monthly traffic: ~1,000 visitors
- Projected traffic: ~2,500 visitors (+150%)

**Optimistic Estimate (12 months):**
- Current monthly traffic: ~1,000 visitors
- Projected traffic: ~4,000 visitors (+300%)

**Key Growth Drivers:**
1. Teacher profile pages ranking for long-tail keywords
2. Subject pages ranking for "{subject} tuition kolkata"
3. Board pages ranking for "{board} tuition kolkata"
4. Improved social media sharing
5. Better Google Knowledge Panel appearance

---

## MAINTENANCE SCHEDULE

### Daily (Automated)
- ✅ Sitemap regeneration (2 AM IST)
- ✅ Monitor sitemap generation logs

### Weekly (Manual - 15 min)
- [ ] Check Google Search Console for errors
- [ ] Review indexed pages count
- [ ] Check structured data validation
- [ ] Monitor Core Web Vitals

### Monthly (Manual - 1 hour)
- [ ] Full SEO audit with tools (Screaming Frog, Ahrefs, SEMrush)
- [ ] Review keyword rankings
- [ ] Analyze traffic trends
- [ ] Update OG images if needed
- [ ] Add new subject/board pages to sitemap

### Quarterly (Manual - 2 hours)
- [ ] Comprehensive technical SEO audit
- [ ] Competitor analysis
- [ ] Update meta descriptions based on CTR data
- [ ] Review and update FAQ schema
- [ ] Check for broken links
- [ ] Update llms.txt if needed

---

## TROUBLESHOOTING

### Issue: Sitemap not updating

**Possible causes:**
1. Cron job not running
2. Database connection failed
3. Environment variables missing

**Debug steps:**
```bash
# Check sitemap generation manually
curl https://www.shikshaq.in/api/sitemap.xml

# Check server logs
tail -f /var/log/sitemap-cron.log

# Test database connection
psql -h your-db-host -U user -d database
SELECT COUNT(*) FROM teachers_list WHERE approved = true;
```

### Issue: Meta tags not appearing

**Possible causes:**
1. SEOHead component not imported
2. Client-side rendering delay
3. useEffect not firing

**Debug steps:**
```bash
# Check page source (View Page Source)
# Search for <meta name="description"

# Check if canonical present
# Search for <link rel="canonical"

# Test with curl
curl -s https://www.shikshaq.in/maths-tuition-teachers-in-kolkata | grep canonical
```

### Issue: Structured data errors

**Possible causes:**
1. Invalid JSON-LD syntax
2. Missing required fields
3. Incorrect @type

**Debug steps:**
1. Copy page source
2. Paste into [Schema Validator](https://validator.schema.org/)
3. Fix errors shown
4. Re-test in Google Rich Results Test

### Issue: Pages not indexing

**Possible causes:**
1. Not in sitemap
2. robots.txt blocking
3. noindex meta tag present
4. Low crawl budget
5. Duplicate content

**Debug steps:**
```bash
# Check if in sitemap
curl https://www.shikshaq.in/api/sitemap.xml | grep "teacher-slug"

# Check robots.txt
curl https://www.shikshaq.in/robots.txt

# Force Google to recrawl
# Go to Google Search Console → URL Inspection → Request Indexing
```

---

## CONTACT & SUPPORT

For questions about this implementation guide:

- **Email:** contact@shikshaq.in
- **Developer:** Check CONTRIBUTING.md for contribution guidelines

For SEO tools and resources:

- **Google Search Console:** https://search.google.com/search-console
- **Rich Results Test:** https://search.google.com/test/rich-results
- **PageSpeed Insights:** https://pagespeed.web.dev/
- **Schema Validator:** https://validator.schema.org/

---

**Document Version:** 1.0
**Last Updated:** March 15, 2026
**Next Review:** June 15, 2026
