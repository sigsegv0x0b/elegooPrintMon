const config = require('../config/config');
const logger = require('../utils/logger');
const LLMResponseParser = require('./llm-response-parser');

class LLMClient {
  constructor() {
    this.baseUrl = config.openaiUrl;
    this.apiKey = config.openaiToken;
    this.model = config.llmModel;
    this.retryCount = 0;
    this.maxRetries = config.maxRetries;
    this.retryDelay = config.retryDelay;
    this.parser = new LLMResponseParser();
  }

  async analyzeImage(imageBuffer, systemPrompt, userPrompt, debugMode = false) {
    try {
      logger.debug(`Sending image to LLM for analysis (model: ${this.model})`);
      
      // Convert image buffer to base64
      const base64Image = imageBuffer.toString('base64');
      
      // Build messages array with system prompt if provided
      const messages = [];
      
      if (systemPrompt && systemPrompt.trim()) {
        messages.push({
          role: "system",
          content: systemPrompt
        });
      }
      
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
        ]
      });
      
      const requestBody = {
        model: this.model,
        messages: messages,
        max_tokens: 4000,
        temperature: 0.1
      };
      
      if (debugMode) {
        console.log('\n=== LLM API Request ===');
        console.log(`URL: ${this.baseUrl}/chat/completions`);
        console.log(`Model: ${this.model}`);
        console.log(`System prompt length: ${systemPrompt?.length || 0} chars`);
        console.log(`User prompt length: ${userPrompt.length} chars`);
        console.log(`Image size: ${imageBuffer.length} bytes (base64: ${base64Image.length} chars)`);
        console.log('Request body (FULL with base64 filtered):');
        
        // Create a filtered copy of the request body for display
        const filteredRequestBody = {
          model: requestBody.model,
          messages: requestBody.messages.map(msg => {
            if (msg.role === 'system') {
              return {
                role: msg.role,
                content: msg.content
              };
            } else if (msg.role === 'user') {
              return {
                role: msg.role,
                content: msg.content.map(contentItem => {
                  if (contentItem.type === 'text') {
                    return contentItem;
                  } else if (contentItem.type === 'image_url') {
                    // Filter the base64 data for cleaner output
                    return {
                      type: 'image_url',
                      image_url: {
                        url: 'data:image/jpeg;base64,<data>'
                      }
                    };
                  }
                  return contentItem;
                })
              };
            }
            return msg;
          }),
          max_tokens: requestBody.max_tokens,
          temperature: requestBody.temperature
        };
        
        console.log(JSON.stringify(filteredRequestBody, null, 2));
      }
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody),
        timeout: 30000 // 30 second timeout for LLM processing
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (debugMode) {
          console.log(`\n=== LLM API Error Response ===`);
          console.log(`Status: ${response.status} ${response.statusText}`);
          console.log(`Error (full): ${errorText}`);
        }
        throw new Error(`LLM API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      if (debugMode) {
        console.log('\n=== LLM API Success Response ===');
        console.log(`Response ID: ${data.id}`);
        console.log(`Model: ${data.model}`);
        console.log(`Usage: ${JSON.stringify(data.usage)}`);
        console.log(`Response content (FULL):`);
        const content = data.choices[0].message.content;
        console.log(content);
        console.log('=== End LLM Debug ===\n');
      }
      
      // Reset retry count on success
      this.retryCount = 0;
      
      logger.debug(`LLM analysis completed successfully`);
      return this.parser.parse(data.choices[0].message.content);
      
    } catch (error) {
      this.retryCount++;
      logger.error(`LLM analysis failed (attempt ${this.retryCount}/${this.maxRetries}): ${error.message}`);
      
      if (this.retryCount >= this.maxRetries) {
        throw new Error(`Max retries (${this.maxRetries}) exceeded for LLM analysis`);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      return this.analyzeImage(imageBuffer, systemPrompt, userPrompt, debugMode); // Retry
    }
  }

  // Test connection to LLM API
  async testConnection() {
    try {
      logger.info(`Testing connection to LLM API at ${this.baseUrl}`);
      
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 5000
      });
      
      if (response.ok) {
        const data = await response.json();
        logger.info(`LLM API connection successful. Available models: ${data.data?.length || 0}`);
        return true;
      } else {
        logger.warn(`LLM API connection test failed (HTTP ${response.status})`);
        return false;
      }
    } catch (error) {
      logger.error(`LLM API connection test failed: ${error.message}`);
      return false;
    }
  }
}

module.exports = LLMClient;