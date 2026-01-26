#!/usr/bin/env node

/**
 * Example: Using the Printer Module for Command Integration
 * 
 * This shows how the printer status module can be used for:
 * - Discord bot commands (/status, /print-status)
 * - Telegram bot commands
 * - Console commands
 * - Web API endpoints
 */

const { createPrinterModule } = require('../src/printer');

// Example 1: Simple status command handler
async function handleStatusCommand() {
    console.log('📡 Processing /status command...\n');
    
    try {
        const printer = createPrinterModule();
        const statusText = await printer.getStatusText();
        
        console.log('✅ Status command result:');
        console.log('='.repeat(60));
        console.log(statusText);
        console.log('='.repeat(60));
        
        return statusText;
        
    } catch (error) {
        const errorMessage = `❌ Error getting printer status: ${error.message}`;
        console.error(errorMessage);
        return errorMessage;
    }
}

// Example 2: Detailed status with structured data
async function handleDetailedStatusCommand() {
    console.log('📊 Processing /print-status command...\n');
    
    try {
        const printer = createPrinterModule();
        const statusData = await printer.getStatus();
        
        if (!statusData.success) {
            return `❌ ${statusData.error}`;
        }
        
        // Format for different platforms
        const response = {
            // For Discord/Telegram (formatted text)
            text: printer.status.formatStatusText(statusData),
            
            // For web API (structured JSON)
            json: statusData,
            
            // For console/CLI (rich output)
            console: formatForConsole(statusData)
        };
        
        console.log('✅ Detailed status retrieved');
        console.log('Structured data available for different platforms');
        
        return response;
        
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        return { error: error.message };
    }
}

// Example 3: Discovery command
async function handleDiscoverCommand() {
    console.log('🔍 Processing /discover-printers command...\n');
    
    try {
        const printer = createPrinterModule();
        const printers = await printer.discoverPrinters();
        
        if (printers.length === 0) {
            return '❌ No printers found on the network';
        }
        
        let response = `✅ Found ${printers.length} printer(s):\n`;
        printers.forEach((printer, index) => {
            response += `\n${index + 1}. **${printer.name}**\n`;
            response += `   IP: ${printer.ip}\n`;
            response += `   Model: ${printer.machineName}\n`;
            response += `   Firmware: ${printer.firmwareVersion}\n`;
        });
        
        console.log(`Discovered ${printers.length} printers`);
        return response;
        
    } catch (error) {
        console.error(`❌ Discovery error: ${error.message}`);
        return `❌ Discovery failed: ${error.message}`;
    }
}

// Helper function to format for console
function formatForConsole(statusData) {
    const { printer, status, progress, time, temperatures } = statusData;
    
    let output = '\n🖨️  PRINTER STATUS REPORT\n';
    output += '='.repeat(50) + '\n';
    output += `Printer: ${printer.name}\n`;
    output += `IP: ${printer.ip}\n`;
    output += `Firmware: ${printer.firmware}\n\n`;
    
    output += `📋 STATUS\n`;
    output += `  Machine: ${status.machine.text}\n`;
    output += `  Print: ${status.print.text}\n`;
    
    if (status.print.filename) {
        output += `  File: ${status.print.filename}\n`;
    }
    
    if (progress) {
        output += `  Progress: ${progress.percent}% (Layer ${progress.currentLayer}/${progress.totalLayers})\n`;
    }
    
    if (time) {
        output += `  Time: ${time.elapsed} / ${time.total} (${time.progressPercent}%)\n`;
        output += `  ETA: ${time.remaining}\n`;
    }
    
    output += `\n🌡️ TEMPERATURES\n`;
    if (temperatures.nozzle.current !== undefined) {
        output += `  Nozzle: ${temperatures.nozzle.current}°C / ${temperatures.nozzle.target}°C\n`;
    }
    if (temperatures.bed.current !== undefined) {
        output += `  Bed: ${temperatures.bed.current}°C / ${temperatures.bed.target}°C\n`;
    }
    
    output += '='.repeat(50) + '\n';
    output += `Last updated: ${new Date(statusData.timestamp).toLocaleString()}\n`;
    
    return output;
}

// Example 4: Integration with Discord.js (conceptual)
class DiscordBotExample {
    constructor() {
        this.printer = createPrinterModule();
    }
    
    async setupCommands() {
        // In a real Discord bot, you would register commands like:
        /*
        client.on('interactionCreate', async interaction => {
            if (!interaction.isCommand()) return;
            
            if (interaction.commandName === 'status') {
                await this.handleDiscordStatus(interaction);
            } else if (interaction.commandName === 'print-status') {
                await this.handleDiscordPrintStatus(interaction);
            } else if (interaction.commandName === 'discover') {
                await this.handleDiscordDiscover(interaction);
            }
        });
        */
    }
    
    async handleDiscordStatus(interaction) {
        await interaction.deferReply();
        
        try {
            const statusText = await this.printer.getStatusText();
            await interaction.editReply(statusText);
        } catch (error) {
            await interaction.editReply(`❌ Error: ${error.message}`);
        }
    }
    
    async handleDiscordPrintStatus(interaction) {
        await interaction.deferReply();
        
        try {
            const statusData = await this.printer.getStatus();
            
            if (!statusData.success) {
                await interaction.editReply(`❌ ${statusData.error}`);
                return;
            }
            
            // Create an embed for Discord
            const embed = {
                title: `🖨️ ${statusData.printer.name}`,
                color: 0x00ff00,
                fields: [
                    {
                        name: 'Status',
                        value: `${statusData.status.machine.text} | ${statusData.status.print.text}`,
                        inline: true
                    }
                ],
                timestamp: new Date(statusData.timestamp)
            };
            
            if (statusData.status.print.filename) {
                embed.fields.push({
                    name: 'Current File',
                    value: statusData.status.print.filename,
                    inline: false
                });
            }
            
            if (statusData.progress) {
                embed.fields.push({
                    name: 'Progress',
                    value: `${statusData.progress.percent}% (Layer ${statusData.progress.currentLayer}/${statusData.progress.totalLayers})`,
                    inline: true
                });
            }
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            await interaction.editReply(`❌ Error: ${error.message}`);
        }
    }
}

// Run examples if this file is executed directly
if (require.main === module) {
    console.log('🚀 Printer Command Integration Examples\n');
    
    // Run example 1
    handleStatusCommand()
        .then(() => {
            console.log('\n' + '='.repeat(60) + '\n');
            return handleDetailedStatusCommand();
        })
        .then(() => {
            console.log('\n' + '='.repeat(60) + '\n');
            return handleDiscoverCommand();
        })
        .then(discoveryResult => {
            console.log('\n' + '='.repeat(60));
            console.log('\n✅ All examples completed!');
            console.log('\n💡 This module can now be used for:');
            console.log('   - /status commands in Discord/Telegram bots');
            console.log('   - /print-status commands with detailed info');
            console.log('   - Automatic printer discovery');
            console.log('   - Web API endpoints for printer status');
        })
        .catch(error => {
            console.error('❌ Example error:', error.message);
        });
}

module.exports = {
    handleStatusCommand,
    handleDetailedStatusCommand,
    handleDiscoverCommand,
    DiscordBotExample
};