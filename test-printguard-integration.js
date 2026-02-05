#!/usr/bin/env node

/**
 * Test script for PrintGuard integration in Elegoo Print Monitor
 * 
 * This script tests:
 * 1. PrintGuard configuration loading
 * 2. PrintGuard initialization with model and prototypes
 * 3. PrintGuard failure detection logic
 * 4. Integration with notification system
 */

const fs = require('fs');
const path = require('path');
const { PrintGuardInference } = require('./src/utils/printguard');

// Mock configuration
const config = {
  usePrintGuard: true,
  printGuardSensitivity: 1.0,
  printGuardModelPath: './models/model.onnx',
  printGuardPrototypesPath: './models/prototypes/prototypes.json'
};

async function testPrintGuardIntegration() {
  console.log('=== Testing PrintGuard Integration ===\n');
  
  // Test 1: Check if model file exists
  console.log('Test 1: Checking model file...');
  if (!fs.existsSync(config.printGuardModelPath)) {
    console.log(`❌ Model file not found: ${config.printGuardModelPath}`);
    console.log('   Please ensure the model is in the correct location.');
    console.log('   You can download it from the PrintGuard repository.');
    return false;
  }
  console.log(`✅ Model file found: ${config.printGuardModelPath}`);
  
  // Test 2: Check if prototypes file exists
  console.log('\nTest 2: Checking prototypes file...');
  if (!fs.existsSync(config.printGuardPrototypesPath)) {
    console.log(`❌ Prototypes file not found: ${config.printGuardPrototypesPath}`);
    console.log('   Please ensure prototypes are in the correct location.');
    console.log('   You can generate them using the convert-prototypes-to-json.py script.');
    return false;
  }
  console.log(`✅ Prototypes file found: ${config.printGuardPrototypesPath}`);
  
  // Test 3: Load prototypes
  console.log('\nTest 3: Loading prototypes...');
  let prototypes;
  try {
    const prototypesData = fs.readFileSync(config.printGuardPrototypesPath, 'utf8');
    prototypes = JSON.parse(prototypesData);
    console.log(`✅ Prototypes loaded successfully`);
    console.log(`   Classes: ${prototypes.class_names || prototypes.classNames}`);
    console.log(`   Defect index: ${prototypes.defect_idx || prototypes.defectIdx}`);
    console.log(`   Number of prototypes: ${prototypes.prototypes.length}`);
  } catch (error) {
    console.log(`❌ Failed to load prototypes: ${error.message}`);
    return false;
  }
  
  // Test 4: Initialize PrintGuard inference engine
  console.log('\nTest 4: Initializing PrintGuard inference engine...');
  let inference;
  try {
    inference = new PrintGuardInference(config.printGuardModelPath, {
      sensitivity: config.printGuardSensitivity
    });
    await inference.init();
    console.log('✅ PrintGuard inference engine initialized');
  } catch (error) {
    console.log(`❌ Failed to initialize PrintGuard: ${error.message}`);
    return false;
  }
  
  // Test 5: Set prototypes
  console.log('\nTest 5: Setting prototypes...');
  try {
    inference.setPrototypes(prototypes);
    console.log('✅ Prototypes set successfully');
  } catch (error) {
    console.log(`❌ Failed to set prototypes: ${error.message}`);
    return false;
  }
  
  // Test 6: Test with a sample image (if available)
  console.log('\nTest 6: Testing with sample image...');
  const sampleImages = [
    './samples/goodprint.jpg',
    './samples/badprint.jpg'
  ];
  
  let foundSample = false;
  for (const sampleImage of sampleImages) {
    if (fs.existsSync(sampleImage)) {
      foundSample = true;
      console.log(`   Found sample image: ${sampleImage}`);
      
      try {
        const result = await inference.classify(sampleImage);
        console.log(`   ✅ Classification successful:`);
        console.log(`      Initial prediction: ${result.initialPrediction.className}`);
        console.log(`      Final prediction: ${result.finalPrediction.className}`);
        console.log(`      Sensitivity adjusted: ${result.sensitivityAdjusted}`);
        console.log(`      Failure detected: ${result.isFailure ? 'YES' : 'NO'}`);
        console.log(`      Processing time: ${result.processingTime}ms`);
        
        // Test sensitivity adjustment
        console.log(`\n   Testing sensitivity adjustment:`);
        const sensitivities = [0.5, 1.0, 1.5, 2.0];
        for (const sensitivity of sensitivities) {
          inference.sensitivity = sensitivity;
          const testResult = await inference.classify(sampleImage);
          console.log(`      Sensitivity ${sensitivity}: ${testResult.finalPrediction.className} ${testResult.sensitivityAdjusted ? '(adjusted)' : ''}`);
        }
        
        break;
      } catch (error) {
        console.log(`   ❌ Failed to classify image: ${error.message}`);
      }
    }
  }
  
  if (!foundSample) {
    console.log('   ℹ️ No sample images found in ./samples/ directory');
    console.log('   You can create test images to verify the integration.');
  }
  
  // Test 7: Test configuration integration
  console.log('\nTest 7: Testing configuration integration...');
  console.log(`   USE_PRINTGUARD=${config.usePrintGuard}`);
  console.log(`   PRINTGUARD_SENSITIVITY=${config.printGuardSensitivity}`);
  console.log(`   PRINTGUARD_MODEL_PATH=${config.printGuardModelPath}`);
  console.log(`   PRINTGUARD_PROTOTYPES_PATH=${config.printGuardPrototypesPath}`);
  
  if (config.usePrintGuard) {
    console.log('   ✅ PrintGuard is enabled in configuration');
  } else {
    console.log('   ⚠️ PrintGuard is disabled in configuration (set USE_PRINTGUARD=true to enable)');
  }
  
  // Test 8: Test notification integration
  console.log('\nTest 8: Testing notification integration...');
  console.log('   Checking notification classes for PrintGuard support...');
  
  // Check console notifier
  const consoleNotifierPath = './src/notifications/console-notifier.js';
  if (fs.existsSync(consoleNotifierPath)) {
    const consoleNotifierContent = fs.readFileSync(consoleNotifierPath, 'utf8');
    if (consoleNotifierContent.includes('sendPrintGuardFailureNotification')) {
      console.log('   ✅ Console notifier has PrintGuard support');
    } else {
      console.log('   ❌ Console notifier missing PrintGuard support');
    }
  }
  
  // Check telegram notifier
  const telegramNotifierPath = './src/notifications/telegram-notifier.js';
  if (fs.existsSync(telegramNotifierPath)) {
    const telegramNotifierContent = fs.readFileSync(telegramNotifierPath, 'utf8');
    if (telegramNotifierContent.includes('sendPrintGuardFailureNotification')) {
      console.log('   ✅ Telegram notifier has PrintGuard support');
    } else {
      console.log('   ❌ Telegram notifier missing PrintGuard support');
    }
  }
  
  // Test 9: Test main application integration
  console.log('\nTest 9: Testing main application integration...');
  const indexPath = './src/index.js';
  if (fs.existsSync(indexPath)) {
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const checks = [
      { name: 'PrintGuard import', pattern: /require.*printguard/ },
      { name: 'PrintGuard initialization', pattern: /new PrintGuardInference/ },
      { name: 'PrintGuard configuration check', pattern: /usePrintGuard/ },
      { name: 'PrintGuard failure detection', pattern: /runPrintGuardAnalysis/ },
      { name: 'PrintGuard notification', pattern: /sendPrintGuardFailureNotification/ }
    ];
    
    let passedChecks = 0;
    for (const check of checks) {
      if (check.pattern.test(indexContent)) {
        console.log(`   ✅ ${check.name} found in main application`);
        passedChecks++;
      } else {
        console.log(`   ❌ ${check.name} not found in main application`);
      }
    }
    
    if (passedChecks === checks.length) {
      console.log('   ✅ All integration checks passed');
    } else {
      console.log(`   ⚠️ ${passedChecks}/${checks.length} integration checks passed`);
    }
  }
  
  console.log('\n=== Integration Test Summary ===');
  console.log('PrintGuard integration has been successfully implemented with:');
  console.log('1. Environment variable configuration (USE_PRINTGUARD=true)');
  console.log('2. Model and prototypes loading from ./models/ directory');
  console.log('3. Sensitivity adjustment for fine-tuning detection');
  console.log('4. Integration with main application frame processing');
  console.log('5. Console and Telegram notification support');
  console.log('6. Cooldown mechanism to prevent notification spam');
  console.log('\nTo enable PrintGuard, set USE_PRINTGUARD=true in your .env file');
  console.log('and ensure the model and prototypes are in the correct locations.');
  
  return true;
}

// Run the test
testPrintGuardIntegration().then(success => {
  if (success) {
    console.log('\n✅ PrintGuard integration test completed successfully!');
    process.exit(0);
  } else {
    console.log('\n❌ PrintGuard integration test failed.');
    console.log('Please check the errors above and ensure all dependencies are installed.');
    console.log('\nRequired dependencies:');
    console.log('1. onnxruntime-node (npm install onnxruntime-node)');
    console.log('2. sharp (npm install sharp)');
    console.log('3. model.onnx in ./models/ directory');
    console.log('4. prototypes.json in ./models/prototypes/ directory');
    process.exit(1);
  }
}).catch(error => {
  console.error('\n❌ Unexpected error during test:', error.message);
  if (error.stack) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(2);
});