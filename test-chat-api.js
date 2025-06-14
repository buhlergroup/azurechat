// Simple test to verify the chat API is working without 404 errors
const fetch = require('node-fetch');

async function testChatAPI() {
  try {
    const response = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'next-auth.session-token=test' // Mock session for testing
      },
      body: JSON.stringify({
        id: 'test-thread-id',
        message: 'Hello, this is a test message',
        selectedModel: 'o3',
        reasoningEffort: 'medium'
      })
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (response.ok) {
      console.log('✅ Chat API is responding successfully');
      const text = await response.text();
      console.log('Response preview:', text.substring(0, 200) + '...');
    } else {
      console.log('❌ Chat API returned error:', response.status, response.statusText);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error) {
    console.error('❌ Failed to test chat API:', error.message);
  }
}

testChatAPI();
