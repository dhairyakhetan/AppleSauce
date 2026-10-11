# Scripts Directory

This directory contains utility scripts for testing and development.

## test-gemini-api.js

Tests the Gemini API key configuration and verifies the API is working.

### Usage

```bash
# Using npm script (recommended)
npm run test:gemini

# Or directly
node scripts/test-gemini-api.js
```

### What it tests

1. ✅ **Environment Variable Check**
   - Verifies `GEMINI_API_KEY` or `VITE_GEMINI_API_KEY` exists
   - Validates API key format

2. ✅ **API Client Initialization**
   - Tests Gemini AI client creation
   - Verifies API key is valid

3. ✅ **Model Availability**
   - Tests `gemini-1.5-flash` (fastest)
   - Falls back to `gemini-pro` if needed
   - Measures response times

4. ✅ **ShikshAq FAQ Test**
   - Tests a real ShikshAq question
   - Verifies response quality and speed
   - Uses optimized prompt configuration

### Environment Variables

The script checks for these environment variables (in order):
1. `GEMINI_API_KEY` (server-side, recommended)
2. `VITE_GEMINI_API_KEY` (client-side)

### Local Testing

For local testing, create a `.env.local` file in the project root:

```env
GEMINI_API_KEY=your_api_key_here
```

Then run:
```bash
npm run test:gemini
```

### Vercel Testing

The script will automatically use the `GEMINI_API_KEY` environment variable set in Vercel if you run it locally with the Vercel CLI:

```bash
vercel env pull .env.local
npm run test:gemini
```

### Expected Output

```
🚀 Testing Gemini API Configuration...

ℹ️  Step 1: Checking environment variables...
✅ API key found (length: 39 chars)
ℹ️  Using GEMINI_API_KEY (server-side)

ℹ️  Step 2: Initializing Gemini AI client...
✅ Gemini AI client initialized

ℹ️  Step 3: Testing model availability...
ℹ️  Testing gemini-1.5-flash...
✅ gemini-1.5-flash responded successfully!
   Response: "Hello, ShikshAq!"
   Response time: 1.23s
   Speed: Excellent (< 3s)

ℹ️  Step 4: Testing ShikshAq FAQ response...
✅ FAQ test successful!
   Response: "Yes! ShikshAq is completely free..."
   Response time: 1.45s

✨ All tests completed!
```

### Troubleshooting

**Error: API key not found**
- Make sure `.env.local` exists with `GEMINI_API_KEY`
- Or verify Vercel environment variables are set

**Error: Invalid API key**
- Check API key format (should start with "AIza")
- Verify API key is correct in Google AI Studio
- Ensure billing is enabled on your Google Cloud project

**Error: Request timeout**
- Check your internet connection
- Verify Google Gemini API is accessible
- Try again (temporary network issues)

**Error: API key doesn't have access**
- Go to Google AI Studio
- Verify the API key has Gemini API access
- Check API quotas/limits

