#!/usr/bin/env node

/**
 * Test script for listing files on Elegoo printer
 * Usage: node test-list-files.js
 */

const { createPrinterModule } = require('./src/printer');

async function testListFiles() {
    console.log('🧪 Testing printer file listing...\n');

    try {
        const printer = createPrinterModule();
        console.log('📡 Requesting file list from printer...');

        console.log('📡 Requesting file list from printer (USB storage)...');
        const fileList = await printer.listFiles();

        console.log('✅ File list retrieved successfully!');
        console.log('📁 Raw response:', JSON.stringify(fileList, null, 2));

        // Format and display the file list
        const files = fileList.FileList || (fileList.Data && fileList.Data.FileList) || [];

        if (files && files.length > 0) {
            console.log(`\n📋 Found ${files.length} items:\n`);

            // Show first 5 files for console output
            const displayFiles = files.slice(0, 5);
            displayFiles.forEach((file, index) => {
                const fileName = file.name || 'Unknown';
                const fileSize = file.FileSize ? formatFileSize(file.FileSize) : 'Unknown size';
                const fileType = file.type === 0 ? '📁 Folder' : file.type === 1 ? '📄 File' : '📄 File';
                const createTime = file.CreateTime ? new Date(file.CreateTime * 1000).toLocaleDateString() : 'Unknown date';

                console.log(`${index + 1}. ${fileName.replace('/local//', '')}`);
                console.log(`   Type: ${fileType}`);
                console.log(`   Size: ${fileSize}`);
                console.log(`   Created: ${createTime}`);
                console.log('');
            });

            if (files.length > 5) {
                console.log(`... and ${files.length - 5} more files\n`);
            }
        } else {
            console.log('📁 No files found on printer');
        }

    } catch (error) {
        console.error('❌ Error listing files:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run the test if this file is executed directly
if (require.main === module) {
    testListFiles()
        .then(() => {
            console.log('✅ Test completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Test failed:', error.message);
            process.exit(1);
        });
}

module.exports = { testListFiles };