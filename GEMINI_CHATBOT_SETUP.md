# Gemini AI Chatbot Setup Guide

## Overview
This guide explains how to set up the Gemini AI chatbot for ShikshAq's FAQ functionality.

## Files Created
1. **`src/components/Chatbot.tsx`** - React component for the chatbot UI
2. **`api/chat.ts`** - Vercel serverless function for Gemini API integration

## Setup Instructions

### 1. Get Gemini API Key
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key (if you don't have one)
3. Copy the API key

### 2. Add API Key to Environment Variables

**For Local Development:**
Create a `.env.local` file in the root directory:
```
VITE_GEMINI_API_KEY=your_api_key_here
```

**For Vercel Deployment:**
1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add a new variable:
   - Key: `GEMINI_API_KEY`
   - Value: Your Gemini API key
   - Environments: Production, Preview, Development
4. Redeploy your application

### 3. API Route Configuration

The API route is located at `/api/chat.ts` and will be automatically detected by Vercel as a serverless function.

**Important Notes:**
- The API route uses Node.js runtime
- The API key is stored server-side and never exposed to the client
- Rate limiting: Free tier has ~15 requests/minute, 1500 requests/day

### 4. Testing Locally

For local testing, you may need to use Vercel CLI or set up a proxy:

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Run dev server with API routes
vercel dev
```

Or use Vite's proxy in `vite.config.ts` (if needed).

## Component Features

### Chatbot UI
- Floating button positioned beside WhatsApp button
- Chat window with message history
- Loading states and error handling
- Responsive design (mobile & desktop)
- Auto-scroll to latest message

### FAQ Context
The chatbot includes FAQ content from your FAQ component, including:
- What ShikshAq is
- How it works
- Safety and verification
- Cost information
- Contact information

## Usage

The chatbot button appears on all pages, positioned beside the WhatsApp button at the bottom-right corner. Users can:
1. Click the "Ask AI" button to open the chatbot
2. Type questions about ShikshAq
3. Get AI-powered responses based on FAQ content
4. Contact team directly if AI can't help

## Customization

### Modify FAQ Context
Edit the `FAQ_CONTEXT` constant in `api/chat.ts` to update the information the AI has access to.

### Change Chatbot Position
Edit the `className` in `Chatbot.tsx` to adjust positioning:
- Button: `fixed bottom-6 right-[9rem]`
- Window: `fixed bottom-24 right-6`

### Adjust AI Responses
Modify the `SYSTEM_PROMPT` in `api/chat.ts` to change:
- Response tone
- Response length
- Fallback behavior

## Troubleshooting

### API Key Not Found
- Ensure `GEMINI_API_KEY` is set in Vercel environment variables
- For local dev, ensure `.env.local` exists with `VITE_GEMINI_API_KEY`

### API Route Not Working
- Check that `/api/chat.ts` exists in the root directory
- Ensure Vercel deployment recognizes the API route
- Check Vercel function logs for errors

### Rate Limit Exceeded
- Free tier: 15 requests/minute, 1500/day
- Implement client-side caching for common questions
- Consider upgrading to paid tier if needed

## Security Notes

- ✅ API key is stored server-side (never exposed to client)
- ✅ API route validates input
- ✅ Error handling prevents sensitive data leaks
- ⚠️ Consider adding rate limiting per user/IP
- ⚠️ Monitor API usage to stay within free tier limits

## Next Steps

1. Add API key to Vercel environment variables
2. Test the chatbot functionality
3. Monitor API usage
4. Refine FAQ context based on common questions
5. Consider adding analytics for chatbot usage

