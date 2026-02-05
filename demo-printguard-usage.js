#!/usr/bin/env node

/**
 * Demonstration of PrintGuard integration usage
 * 
 * This script shows how to:
 * 1. Enable PrintGuard via environment variables
 * 2. Configure PrintGuard settings
 * 3. Use PrintGuard in the main application
 */

const fs = require('fs');
const path = require('path');

console.log('=== PrintGuard Integration Demo ===\n');

console.log('PrintGuard has been successfully integrated into the Elegoo Print Monitor system.');
console.log('Here\'s how to use it:\n');

console.log('1. ENABLE PRINTGUARD:');
console.log('   Add the following to your .env file:');
console.log('   USE_PRINTGUARD=true');
console.log('   PRINTGUARD_SENSITIVITY=1.0');
console.log('   PRINTGUARD_MODEL_PATH=./models/model.onnx');
console.log('   PRINTGUARD_PROTOTYPES_PATH=./models/prototypes/prototypes.json\n');

console.log('2. CONFIGURE SENSITIVITY:');
console.log('   - Sensitivity < 1.0: More conservative (fewer false positives)');
console.log('   - Sensitivity = 1.0: Default (balanced)');
console.log('   - Sensitivity > 1.0: More sensitive (more defect detections)');
console.log('   Example: PRINTGUARD_SENSITIVITY=1.2 for more sensitive detection\n');

console.log('3. VERIFY FILES:');
console.log('   Ensure these files exist:');
console.log('   - models/model.onnx (PrintGuard model)');
console.log('   - models/prototypes/prototypes.json (pre-computed prototypes)');
console.log('   You can generate prototypes using convert-prototypes-to-json.py\n');

console.log('4. HOW IT WORKS:');
console.log('   When USE_PRINTGUARD=true:');
console.log('   - The system loads PrintGuard during startup');
console.log('   - Each captured frame is analyzed by PrintGuard');
console.log('   - If a failure is detected, notifications are sent');
console.log('   - A cooldown period prevents notification spam\n');

console.log('5. NOTIFICATIONS:');
console.log('   PrintGuard failure notifications include:');
console.log('   - Frame number and timestamp');
console.log('   - PrintGuard analysis results');
console.log('   - Distances to success/failure prototypes');
console.log('   - Sensitivity adjustment status');
console.log('   - Captured image\n');

console.log('6. INTEGRATION WITH EXISTING SYSTEM:');
console.log('   PrintGuard works alongside the existing LLM-based analysis:');
console.log('   - If LLM is enabled: Both systems run in parallel');
console.log('   - If LLM is disabled: PrintGuard provides failure detection');
console.log('   - PrintGuard only runs when printer is actively printing\n');

console.log('7. TESTING:');
console.log('   You can test PrintGuard with:');
console.log('   node test-printguard-integration.js');
console.log('   node test-image.js samples/goodprint.jpg');
console.log('   node test-image.js samples/badprint.jpg\n');

console.log('8. TROUBLESHOOTING:');
console.log('   Common issues and solutions:');
console.log('   - Missing model.onnx: Download from PrintGuard repository');
console.log('   - Missing prototypes: Run convert-prototypes-to-json.py');
console.log('   - ONNX Runtime errors: Ensure onnxruntime-node is installed');
console.log('   - Memory issues: PrintGuard uses ~200MB RAM\n');

console.log('=== Sample .env Configuration ===\n');

const sampleEnv = `# PrintGuard Configuration
USE_PRINTGUARD=true
PRINTGUARD_SENSITIVITY=1.0
PRINTGUARD_MODEL_PATH=./models/model.onnx
PRINTGUARD_PROTOTYPES_PATH=./models/prototypes/prototypes.json

# Existing LLM Configuration (optional)
LLM_MODE=enabled
LLM_API_KEY=your_api_key_here
LLM_MODEL=gpt-4-vision-preview

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_ALERT_LEVEL=critical

# Printer Configuration
PRINTER_IP=192.168.1.100
PRINTER_PORT=80
CAPTURE_INTERVAL=30`;

console.log(sampleEnv);
console.log('\n=== Integration Complete ===');
console.log('PrintGuard is now ready to detect 3D printing failures!');
console.log('Start the monitor with: npm start');
console.log('Or in development: npm run dev');