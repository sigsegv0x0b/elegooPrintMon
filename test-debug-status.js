#!/usr/bin/env node

// Simple test to debug status change detection
const config = require('./src/config/config');

// Mock the config to avoid Telegram initialization
config.telegramBotToken = '';
config.telegramChatId = '';

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
  }
};

console.log('=== Testing hasPrinterStatusChanged() ===');
const monitor = new PrintMonitor();

// Manually check the initial state
console.log(`Initial hasHadValidPrinterStatus: ${monitor.hasHadValidPrinterStatus}`);
console.log(`Initial lastPrinterStatus: ${monitor.lastPrinterStatus}`);

// Test first status
const statusChanged = monitor.hasPrinterStatusChanged(mockCurrentStatus, null);
console.log(`First status changed: ${statusChanged}`);
console.log(`Expected: true (first valid status)`);
console.log(`After check, hasHadValidPrinterStatus: ${monitor.hasHadValidPrinterStatus}`);

// Test with previous status
const mockPreviousStatus = {
  success: true,
  timestamp: new Date(Date.now() - 60000).toISOString(),
  status: {
    machine: {
      code: 0, // Idle
      text: 'Idle'
    }
  }
};

const statusChanged2 = monitor.hasPrinterStatusChanged(mockCurrentStatus, mockPreviousStatus);
console.log(`\nSecond test with previous status:`);
console.log(`Status changed: ${statusChanged2}`);
console.log(`Expected: true (machine status changed from Idle to Printing)`);

// Test with same status
const statusChanged3 = monitor.hasPrinterStatusChanged(mockCurrentStatus, mockCurrentStatus);
console.log(`\nThird test with same status:`);
console.log(`Status changed: ${statusChanged3}`);
console.log(`Expected: false (same machine status)`);