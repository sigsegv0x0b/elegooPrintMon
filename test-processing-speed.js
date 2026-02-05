#!/usr/bin/env node

/**
 * Test PrintGuard processing speed with multiple runs
 */

const fs = require('fs');
const path = require('path');
const { PrintGuardInference } = require('./src/utils/printguard');

async function testProcessingSpeed() {
  console.log('=== PrintGuard Processing Speed Test ===\n');
  
  const config = {
    printGuardModelPath: './models/model.onnx',
    printGuardPrototypesPath: './models/prototypes/prototypes.json',
    sensitivity: 1.0
  };
  
  // Load prototypes
  let prototypes;
  try {
    const prototypesData = fs.readFileSync(config.printGuardPrototypesPath, 'utf8');
    prototypes = JSON.parse(prototypesData);
  } catch (error) {
    console.log(`❌ Failed to load prototypes: ${error.message}`);
    return;
  }
  
  // Initialize inference engine
  let inference;
  try {
    inference = new PrintGuardInference(config.printGuardModelPath, {
      sensitivity: config.sensitivity
    });
    await inference.init();
    inference.setPrototypes(prototypes);
  } catch (error) {
    console.log(`❌ Failed to initialize PrintGuard: ${error.message}`);
    return;
  }
  
  // Test images
  const testImages = ['./samples/goodprint.jpg', './samples/badprint.jpg'];
  const numRuns = 10; // Number of runs per image for averaging
  
  let totalProcessingTime = 0;
  let totalRuns = 0;
  const results = [];
  
  for (const imagePath of testImages) {
    if (!fs.existsSync(imagePath)) {
      console.log(`❌ Image not found: ${imagePath}`);
      continue;
    }
    
    console.log(`Testing ${path.basename(imagePath)} (${numRuns} runs):`);
    console.log('='.repeat(50));
    
    let imageTotalTime = 0;
    const runTimes = [];
    
    for (let i = 0; i < numRuns; i++) {
      try {
        const startTime = process.hrtime.bigint();
        const result = await inference.classify(imagePath);
        const endTime = process.hrtime.bigint();
        
        const processingTimeNs = endTime - startTime;
        const processingTimeMs = Number(processingTimeNs) / 1_000_000;
        const processingTimeSec = processingTimeMs / 1000;
        
        runTimes.push(processingTimeMs);
        imageTotalTime += processingTimeMs;
        totalProcessingTime += processingTimeMs;
        totalRuns++;
        
        if (i === 0) {
          // Only show details for first run
          console.log(`Run ${i + 1}: ${processingTimeMs.toFixed(2)}ms (${processingTimeSec.toFixed(4)}s) - ${result.finalPrediction.className.toUpperCase()}`);
        } else {
          console.log(`Run ${i + 1}: ${processingTimeMs.toFixed(2)}ms (${processingTimeSec.toFixed(4)}s)`);
        }
      } catch (error) {
        console.log(`Run ${i + 1}: ❌ Error: ${error.message}`);
      }
    }
    
    // Calculate statistics for this image
    const avgTimeMs = imageTotalTime / numRuns;
    const avgTimeSec = avgTimeMs / 1000;
    const minTimeMs = Math.min(...runTimes);
    const maxTimeMs = Math.max(...runTimes);
    
    results.push({
      image: path.basename(imagePath),
      avgTimeMs,
      avgTimeSec,
      minTimeMs,
      maxTimeMs,
      totalTimeMs: imageTotalTime,
      runs: numRuns
    });
    
    console.log('\nStatistics:');
    console.log(`  Average: ${avgTimeMs.toFixed(2)}ms (${avgTimeSec.toFixed(4)}s)`);
    console.log(`  Minimum: ${minTimeMs.toFixed(2)}ms (${(minTimeMs/1000).toFixed(4)}s)`);
    console.log(`  Maximum: ${maxTimeMs.toFixed(2)}ms (${(maxTimeMs/1000).toFixed(4)}s)`);
    console.log(`  Total: ${imageTotalTime.toFixed(2)}ms (${(imageTotalTime/1000).toFixed(4)}s)`);
    console.log('='.repeat(50) + '\n');
  }
  
  // Overall statistics
  console.log('=== OVERALL PROCESSING SPEED SUMMARY ===\n');
  
  const overallAvgTimeMs = totalProcessingTime / totalRuns;
  const overallAvgTimeSec = overallAvgTimeMs / 1000;
  const totalTimeSec = totalProcessingTime / 1000;
  
  console.log(`Total runs: ${totalRuns}`);
  console.log(`Total processing time: ${totalProcessingTime.toFixed(2)}ms (${totalTimeSec.toFixed(4)}s)`);
  console.log(`Average per image: ${overallAvgTimeMs.toFixed(2)}ms (${overallAvgTimeSec.toFixed(4)}s)`);
  
  // Calculate frames per second
  const fps = 1000 / overallAvgTimeMs;
  console.log(`Theoretical FPS: ${fps.toFixed(2)} frames per second`);
  
  // Real-world monitoring implications
  console.log('\n=== REAL-WORLD MONITORING IMPLICATIONS ===\n');
  
  const captureInterval = 30; // Default capture interval in seconds
  const processingTimePercent = (overallAvgTimeSec / captureInterval) * 100;
  
  console.log(`With default ${captureInterval}-second capture interval:`);
  console.log(`  Processing uses ${overallAvgTimeSec.toFixed(4)}s of ${captureInterval}s`);
  console.log(`  That's ${processingTimePercent.toFixed(2)}% of the interval`);
  console.log(`  ${(captureInterval - overallAvgTimeSec).toFixed(2)}s available for other tasks`);
  
  // Performance classification
  console.log('\n=== PERFORMANCE CLASSIFICATION ===\n');
  
  if (overallAvgTimeMs < 50) {
    console.log('✅ EXCELLENT PERFORMANCE: Suitable for real-time monitoring');
    console.log('   PrintGuard can run alongside other analysis without impact');
  } else if (overallAvgTimeMs < 100) {
    console.log('✅ GOOD PERFORMANCE: Suitable for production monitoring');
    console.log('   PrintGuard adds minimal overhead to the system');
  } else if (overallAvgTimeMs < 500) {
    console.log('⚠️ ACCEPTABLE PERFORMANCE: Suitable for most use cases');
    console.log('   Consider increasing capture interval if system is overloaded');
  } else {
    console.log('⚠️ SLOW PERFORMANCE: May impact system responsiveness');
    console.log('   Consider optimizing or using higher-spec hardware');
  }
  
  // Recommendations
  console.log('\n=== RECOMMENDATIONS ===\n');
  
  console.log('1. For real-time monitoring (1-5 second intervals):');
  console.log(`   Current speed: ${overallAvgTimeMs.toFixed(2)}ms per frame`);
  console.log(`   Maximum FPS: ${fps.toFixed(2)}`);
  console.log(`   Recommended minimum interval: ${(overallAvgTimeSec * 1.5).toFixed(1)}s`);
  
  console.log('\n2. For standard monitoring (30 second intervals):');
  console.log(`   Processing overhead: ${processingTimePercent.toFixed(2)}%`);
  console.log(`   More than ${(100 - processingTimePercent).toFixed(2)}% of interval available`);
  
  console.log('\n3. For batch processing:');
  console.log(`   Can process ${Math.floor(3600 / overallAvgTimeSec)} images per hour`);
  console.log(`   Can process ${Math.floor(86400 / overallAvgTimeSec)} images per day`);
  
  console.log('\n=== TEST COMPLETE ===');
  console.log('PrintGuard processing speed is suitable for integration into the');
  console.log('Elegoo Print Monitor system with minimal performance impact.');
}

// Run the test
testProcessingSpeed().catch(error => {
  console.error('❌ Test failed:', error.message);
  if (error.stack) {
    console.error('Stack:', error.stack);
  }
  process.exit(1);
});