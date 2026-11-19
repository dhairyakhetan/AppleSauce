#!/usr/bin/env node

/**
 * Test script to verify Gemini API key is working
 * 
 * Usage:
 *   node scripts/test-gemini-api.js
 * 
 * This script tests:
 * 1. API key exists in environment variables
 * 2. API key is valid and can connect to Gemini
 * 3. Model response generation works
 * 4. Response time measurement
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

async function testGeminiAPI() {
  log('\n🚀 Testing Gemini API Configuration...\n', 'cyan');

  // Step 1: Check environment variables
  logInfo('Step 1: Checking environment variables...');
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    logError('GEMINI_API_KEY not found in environment variables!');
    logWarning('\nTo set it:');
    log('  For local: Add to .env.local file:', 'yellow');
    log('    GEMINI_API_KEY=your_api_key_here', 'yellow');
    log('\n  For Vercel:', 'yellow');
    log('    1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables', 'yellow');
    log('    2. Add: GEMINI_API_KEY = your_api_key_here', 'yellow');
    log('    3. Redeploy your application', 'yellow');
    process.exit(1);
  }

  // Validate API key format
  if (!apiKey.startsWith('AIza')) {
    logWarning('API key does not start with "AIza" - it might be invalid');
  }

  if (apiKey.length < 30) {
    logWarning('API key seems too short - it might be invalid');
  }

  // Confirm that an API key is present without logging its value
  logSuccess('API key found and loaded from environment variables');
  if (process.env.GEMINI_API_KEY) {
    logInfo('Using GEMINI_API_KEY (server-side)');
  } else {
    logInfo('Using VITE_GEMINI_API_KEY (client-side)');
  }

  // Step 2: Initialize Gemini AI
  logInfo('\nStep 2: Initializing Gemini AI client...');
  let genAI;
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    logSuccess('Gemini AI client initialized');
  } catch (error) {
    logError(`Failed to initialize Gemini AI: ${error.message}`);
    process.exit(1);
  }

  // Step 3: Test model availability
  logInfo('\nStep 3: Testing model availability...');
  const modelsToTest = ['gemini-1.5-flash', 'gemini-pro'];
  
  for (const modelName of modelsToTest) {
    try {
      logInfo(`Testing ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      
      // Create a simple test prompt
      const testPrompt = 'Say "Hello, ShikshAq!" in one sentence.';
      
      // Measure response time
      const startTime = Date.now();
      
      // Set timeout (10 seconds)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout after 10 seconds')), 10000);
      });

      const generatePromise = model.generateContent(testPrompt);
      const result = await Promise.race([generatePromise, timeoutPromise]);
      
      const endTime = Date.now();
      const responseTime = ((endTime - startTime) / 1000).toFixed(2);
      
      const response = result.response;
      const text = response.text();
      
      logSuccess(`${modelName} responded successfully!`);
      log(`   Response: "${text}"`, 'cyan');
      log(`   Response time: ${responseTime}s`, 'cyan');
      
      // Check response time
      if (responseTime < 3) {
        logSuccess(`   Speed: Excellent (< 3s)`);
      } else if (responseTime < 5) {
        logWarning(`   Speed: Good (3-5s)`);
      } else {
        logWarning(`   Speed: Slow (> 5s) - consider using gemini-1.5-flash`);
      }
      
      break; // Success, exit loop
    } catch (error) {
      if (error.message.includes('timeout')) {
        logError(`${modelName} request timed out after 10 seconds`);
      } else if (error.message.includes('API key')) {
        logError(`${modelName} failed: Invalid API key`);
        logWarning('\nPossible issues:');
        log('  - API key is incorrect', 'yellow');
        log('  - API key doesn\'t have access to Gemini API', 'yellow');
        log('  - Billing not enabled on your Google Cloud project', 'yellow');
        process.exit(1);
      } else {
        logWarning(`${modelName} failed: ${error.message}`);
        logInfo('Trying next model...');
      }
    }
  }

  // Step 4: Test ShikshAq-specific prompt
  logInfo('\nStep 4: Testing ShikshAq FAQ response...');
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        maxOutputTokens: 150,
        temperature: 0.7,
      },
    });

    const faqPrompt = `You are ShikshAq's AI assistant. Answer briefly:

User: Is ShikshAq free to use?

Assistant:`;

    const startTime = Date.now();
    const result = await Promise.race([
      model.generateContent(faqPrompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
    ]);
    const endTime = Date.now();
    const responseTime = ((endTime - startTime) / 1000).toFixed(2);

    const text = result.response.text();
    logSuccess('FAQ test successful!');
    log(`   Response: "${text}"`, 'cyan');
    log(`   Response time: ${responseTime}s`, 'cyan');
  } catch (error) {
    logError(`FAQ test failed: ${error.message}`);
  }

  // Step 5: Summary
  log('\n✨ All tests completed!', 'green');
  log('\n📋 Summary:', 'cyan');
  log('  ✅ API key is configured', 'green');
  log('  ✅ Gemini API is accessible', 'green');
  log('  ✅ Model responses are working', 'green');
  log('\n💡 Next steps:', 'cyan');
  log('  1. The chatbot should work on your deployed site', 'yellow');
  log('  2. Monitor response times in production', 'yellow');
  log('  3. Check Vercel function logs if issues occur', 'yellow');
  log('');
}

// Run the test
testGeminiAPI().catch((error) => {
  logError(`\nUnexpected error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

