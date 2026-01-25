// Load environment variables
require('dotenv').config();

const config = {
  // Printer stream
  mjpegStreamUrl: process.env.MJPEG_STREAM_URL || 'http://192.168.10.179:3031/video',
  frameCaptureInterval: parseInt(process.env.FRAME_CAPTURE_INTERVAL || '10000'),
  
  // LLM Configuration
  openaiUrl: process.env.OPENAI_URL || 'http://localhost:1234/v1',
  openaiToken: process.env.OPENAI_TOKEN || '',
  llmModel: process.env.LLM_MODEL || 'qwen/qwen3-vl-4b',
  
  // Telegram Configuration
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  notificationThreshold: parseFloat(process.env.NOTIFICATION_THRESHOLD || '0.8'),
  telegramAlertLevel: process.env.TELEGRAM_ALERT_LEVEL || 'critical', // 'all', 'warning', 'critical', 'none'
  
  // Application Settings
  logLevel: process.env.LOG_LEVEL || 'info',
  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
  retryDelay: parseInt(process.env.RETRY_DELAY || '5000'),
  llmCooldownSeconds: parseInt(process.env.LLM_COOLDOWN_SECONDS || '10'), // Seconds to wait after LLM reply
  
  // Validation
  validate: function() {
    const errors = [];
    
    if (!this.mjpegStreamUrl) errors.push('MJPEG_STREAM_URL is required');
    
    // Telegram is optional - warn if not configured but don't fail
    if (!this.telegramBotToken || !this.telegramChatId) {
      console.warn('Telegram credentials not configured - notifications will be logged only');
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n${errors.join('\n')}`);
    }
    
    return true;
  }
};

module.exports = config;