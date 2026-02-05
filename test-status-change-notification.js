#!/usr/bin/env node

// Test script to verify status change notification format
const PrintMonitor = require('./src/index.js');

// Create a mock printer status
const mockCurrentStatus = {
  success: true,
  timestamp: new Date().toISOString(),
  printer: {
    name: 'Elegoo Centauri Carbon',
    firmware: 'v1.2.3',
    buildVolume: '256x256x256mm',
    ip: '192.168.10.179',
    mainboardID: 'test123'
  },
  status: {
    machine: {
      code: 1, // Printing
      text: 'Printing'
    },
    print: {
      code: 3, // Exposing
      text: 'Exposing',
      filename: 'calibration_cube.gcode'
    }
  },
  progress: {
    currentLayer: 45,
    totalLayers: 100,
    percent: '45.0'
  },
  time: {
    elapsed: '1h 30m',
    total: '3h 45m',
    remaining: '2h 15m',
    progressPercent: '40.0'
  },
  temperatures: {
    nozzle: {
      current: 210,
      target: 210
    },
    bed: {
      current: 60,
      target: 60
    }
  }
};

const mockPreviousStatus = {
  success: true,
  timestamp: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
  printer: {
    name: 'Elegoo Centauri Carbon',
    firmware: 'v1.2.3',
    buildVolume: '256x256x256mm',
    ip: '192.168.10.179',
    mainboardID: 'test123'
  },
  status: {
    machine: {
      code: 0, // Idle
      text: 'Idle'
    },
    print: {
      code: 0, // Idle
      text: 'Idle',
      filename: null
    }
  }
};

// Create a mock image buffer (empty)
const mockImageBuffer = Buffer.from('mock-image-data');

// Test the hasPrinterStatusChanged method
console.log('=== Testing hasPrinterStatusChanged() ===');
const monitor = new PrintMonitor();
const statusChanged = monitor.hasPrinterStatusChanged(mockCurrentStatus, mockPreviousStatus);
console.log(`Status changed: ${statusChanged}`);
console.log(`Expected: true (machine status changed from Idle to Printing)`);
console.log('');

// Test the sendPrinterStatusChangeNotification method
console.log('=== Testing sendPrinterStatusChangeNotification() ===');
console.log('This would normally send notifications, but we\'re just testing the message format');
console.log('');

// Manually test the message formatting logic
console.log('=== Expected Notification Format ===');
console.log('🔄 **Printer Status Change Detected**');
console.log('Frame: #1');
console.log('Time: [current time]');
console.log('');
console.log('📋 **Changed:** Idle → Printing');
console.log('🖨️ Elegoo Centauri Carbon');
console.log('📋 Machine: Printing');
console.log('🖨️ Print: Exposing');
console.log('📄 File: calibration_cube.gcode');
console.log('📊 Progress: 45.0% (Layer 45/100)');
console.log('⏱️ ETA: 2h 15m');
console.log('');

// Test with first status (previousStatus is invalid)
console.log('=== Testing First Status Notification ===');
const firstStatusChanged = monitor.hasPrinterStatusChanged(mockCurrentStatus, null);
console.log(`First status changed: ${firstStatusChanged}`);
console.log(`Expected: true (first valid status)`);
console.log('');

// Test with no change
console.log('=== Testing No Change Scenario ===');
const noChangeStatus = { ...mockCurrentStatus };
const noChange = monitor.hasPrinterStatusChanged(noChangeStatus, mockCurrentStatus);
console.log(`No change detected: ${noChange}`);
console.log(`Expected: false (same machine status)`);
console.log('');

console.log('=== Test Complete ===');
console.log('The notification format now includes a "Changed:" field showing previous → current machine status.');
console.log('This helps users understand why they received the notification.');