/**
 * Test file for Azure OpenAI v1 Responses API features
 * This file demonstrates all the new capabilities of the v1 API
 */

const { OpenAI } = require('openai');

// Configuration
const config = {
  apiKey: process.env.AZURE_OPENAI_API_KEY || 'your-api-key',
  baseURL: `https://${process.env.AZURE_OPENAI_API_INSTANCE_NAME || 'your-instance'}.openai.azure.com/openai/v1/`,
  defaultQuery: { "api-version": "preview" }
};

const client = new OpenAI(config);

// Test 1: Basic text generation with gpt-4o
async function testBasicTextGeneration() {
  console.log('🧪 Testing basic text generation...');
  
  try {
    const response = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Explain quantum computing in simple terms" }]
        }
      ],
      stream: false
    });

    console.log('✅ Basic text generation successful');
    console.log('Response:', response.output[0].content[0].text);
    return response;
  } catch (error) {
    console.error('❌ Basic text generation failed:', error.message);
    throw error;
  }
}

// Test 2: Reasoning with o3 model
async function testReasoningWithSummary() {
  console.log('🧪 Testing reasoning with summary...');
  
  try {
    const response = await client.responses.create({
      model: "o3",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ 
            type: "input_text", 
            text: "Solve this step by step: If a train travels 120 miles in 2 hours, and then 180 miles in 3 hours, what is its average speed for the entire journey?" 
          }]
        }
      ],
      reasoning: {
        effort: "medium",
        summary: "detailed"
      },
      stream: false
    });

    console.log('✅ Reasoning test successful');
    console.log('Response:', response.output[0].content[0].text);
    
    // Check for reasoning summary
    const reasoningItem = response.output.find(item => item.type === "reasoning");
    if (reasoningItem) {
      console.log('🧠 Reasoning summary found:', reasoningItem.summary[0].text);
    }
    
    return response;
  } catch (error) {
    console.error('❌ Reasoning test failed:', error.message);
    throw error;
  }
}

// Test 3: Streaming response
async function testStreaming() {
  console.log('🧪 Testing streaming response...');
  
  try {
    const stream = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Write a short story about a robot learning to paint" }]
        }
      ],
      stream: true
    });

    console.log('✅ Streaming started');
    let fullContent = '';
    
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        process.stdout.write(event.delta);
        fullContent += event.delta;
      } else if (event.type === 'response.done') {
        console.log('\n✅ Streaming completed');
        break;
      }
    }
    
    return { content: fullContent };
  } catch (error) {
    console.error('❌ Streaming test failed:', error.message);
    throw error;
  }
}

// Test 4: Function calling
async function testFunctionCalling() {
  console.log('🧪 Testing function calling...');
  
  try {
    const response = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "What's the weather like in Paris?" }]
        }
      ],
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get the current weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The city name"
              }
            },
            required: ["location"]
          }
        }
      ],
      stream: false
    });

    console.log('✅ Function calling test successful');
    
    // Check for function calls
    const functionCall = response.output.find(item => item.type === "function_call");
    if (functionCall) {
      console.log('🔧 Function called:', functionCall.name, 'with args:', functionCall.arguments);
      
      // Simulate function response
      const followUpResponse = await client.responses.create({
        model: "gpt-4o",
        previous_response_id: response.id,
        input: [
          {
            type: "function_call_output",
            call_id: functionCall.call_id,
            output: JSON.stringify({ temperature: "22°C", condition: "Sunny" })
          }
        ],
        stream: false
      });
      
      console.log('🔧 Function response:', followUpResponse.output[0].content[0].text);
      return followUpResponse;
    }
    
    return response;
  } catch (error) {
    console.error('❌ Function calling test failed:', error.message);
    throw error;
  }
}

// Test 5: Response chaining
async function testResponseChaining() {
  console.log('🧪 Testing response chaining...');
  
  try {
    // First response
    const firstResponse = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "What is machine learning?" }]
        }
      ],
      stream: false
    });

    console.log('✅ First response created');
    
    // Chained response
    const secondResponse = await client.responses.create({
      model: "gpt-4o",
      previous_response_id: firstResponse.id,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Can you explain that in simpler terms for a 10-year-old?" }]
        }
      ],
      stream: false
    });

    console.log('✅ Response chaining successful');
    console.log('Chained response:', secondResponse.output[0].content[0].text);
    
    return { firstResponse, secondResponse };
  } catch (error) {
    console.error('❌ Response chaining test failed:', error.message);
    throw error;
  }
}

// Test 6: Image generation (if gpt-image-1 is available)
async function testImageGeneration() {
  console.log('🧪 Testing image generation...');
  
  try {
    const response = await client.responses.create({
      model: "gpt-4o", // Will use image generation tool
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Generate an image of a sunset over mountains" }]
        }
      ],
      tools: [{ type: "image_generation" }],
      stream: false,
      // Add image generation deployment header if needed
      ...(process.env.AZURE_OPENAI_GPT_IMAGE_DEPLOYMENT_NAME && {
        defaultHeaders: {
          "x-ms-oai-image-generation-deployment": process.env.AZURE_OPENAI_GPT_IMAGE_DEPLOYMENT_NAME
        }
      })
    });

    console.log('✅ Image generation test successful');
    
    // Check for image generation
    const imageCall = response.output.find(item => item.type === "image_generation_call");
    if (imageCall) {
      console.log('🎨 Image generated successfully (base64 data available)');
      console.log('Image size:', imageCall.result.length, 'characters');
    }
    
    return response;
  } catch (error) {
    console.error('❌ Image generation test failed:', error.message);
    // Don't throw - this might not be available in all deployments
    return null;
  }
}

// Test 7: Background task (for long-running operations)
async function testBackgroundTask() {
  console.log('🧪 Testing background task...');
  
  try {
    const response = await client.responses.create({
      model: "o3",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ 
            type: "input_text", 
            text: "Write a detailed analysis of renewable energy trends over the past decade" 
          }]
        }
      ],
      background: true,
      reasoning: {
        effort: "high"
      }
    });

    console.log('✅ Background task started, ID:', response.id);
    console.log('Status:', response.status);
    
    // Poll for completion
    let attempts = 0;
    const maxAttempts = 10;
    
    while (response.status === 'queued' || response.status === 'in_progress') {
      if (attempts >= maxAttempts) {
        console.log('⏰ Background task still running after max attempts');
        break;
      }
      
      console.log(`⏳ Polling attempt ${attempts + 1}, status: ${response.status}`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const updatedResponse = await client.responses.retrieve(response.id);
      Object.assign(response, updatedResponse);
      attempts++;
    }
    
    if (response.status === 'completed') {
      console.log('✅ Background task completed');
      console.log('Result:', response.output[0].content[0].text.substring(0, 200) + '...');
    }
    
    return response;
  } catch (error) {
    console.error('❌ Background task test failed:', error.message);
    throw error;
  }
}

// Test 8: Multimodal input (text + image)
async function testMultimodalInput() {
  console.log('🧪 Testing multimodal input...');
  
  try {
    // Using a sample image URL (you can replace with actual image)
    const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg";
    
    const response = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "What do you see in this image?" },
            { type: "input_image", image_url: imageUrl }
          ]
        }
      ],
      stream: false
    });

    console.log('✅ Multimodal input test successful');
    console.log('Response:', response.output[0].content[0].text);
    
    return response;
  } catch (error) {
    console.error('❌ Multimodal input test failed:', error.message);
    // Don't throw - this might not be available in all deployments
    return null;
  }
}

// Test 9: Response management operations
async function testResponseManagement() {
  console.log('🧪 Testing response management...');
  
  try {
    // Create a response
    const response = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello, this is a test message" }]
        }
      ],
      stream: false
    });

    const responseId = response.id;
    console.log('✅ Response created:', responseId);
    
    // Retrieve the response
    const retrieved = await client.responses.retrieve(responseId);
    console.log('✅ Response retrieved successfully');
    
    // List input items
    const inputItems = await client.responses.input_items.list(responseId);
    console.log('✅ Input items listed:', inputItems.data.length, 'items');
    
    // Delete the response
    await client.responses.delete(responseId);
    console.log('✅ Response deleted successfully');
    
    return { response, retrieved, inputItems };
  } catch (error) {
    console.error('❌ Response management test failed:', error.message);
    throw error;
  }
}

// Main test runner
async function runAllTests() {
  console.log('🚀 Starting Azure OpenAI v1 Responses API tests...\n');
  
  const results = {};
  
  try {
    results.basicText = await testBasicTextGeneration();
    console.log('\n');
    
    results.reasoning = await testReasoningWithSummary();
    console.log('\n');
    
    results.streaming = await testStreaming();
    console.log('\n');
    
    results.functionCalling = await testFunctionCalling();
    console.log('\n');
    
    results.chaining = await testResponseChaining();
    console.log('\n');
    
    results.imageGeneration = await testImageGeneration();
    console.log('\n');
    
    results.backgroundTask = await testBackgroundTask();
    console.log('\n');
    
    results.multimodal = await testMultimodalInput();
    console.log('\n');
    
    results.management = await testResponseManagement();
    console.log('\n');
    
    console.log('🎉 All tests completed successfully!');
    
    // Summary
    console.log('\n📊 Test Summary:');
    Object.entries(results).forEach(([test, result]) => {
      console.log(`  ${test}: ${result ? '✅ Passed' : '❌ Failed'}`);
    });
    
  } catch (error) {
    console.error('💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testBasicTextGeneration,
  testReasoningWithSummary,
  testStreaming,
  testFunctionCalling,
  testResponseChaining,
  testImageGeneration,
  testBackgroundTask,
  testMultimodalInput,
  testResponseManagement,
  runAllTests
};
