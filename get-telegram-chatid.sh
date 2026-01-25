#!/bin/bash

# Telegram Chat ID Getter Script
# This script automatically retrieves the chat ID for a Telegram bot
# and displays it for manual configuration in the .env file.

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for required commands
check_dependencies() {
    local missing_deps=()
    
    if ! command_exists curl; then
        missing_deps+=("curl")
    fi
    
    if ! command_exists jq; then
        missing_deps+=("jq")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing dependencies: ${missing_deps[*]}"
        echo "Please install them using:"
        echo "  sudo apt-get install curl jq  # Debian/Ubuntu"
        echo "  brew install curl jq          # macOS"
        exit 1
    fi
}

# Function to read .env file
read_env_file() {
    local env_file=".env"
    
    if [ ! -f "$env_file" ]; then
        print_error ".env file not found!"
        echo "Please copy .env.example to .env and add your Telegram bot token"
        exit 1
    fi
    
    # Read TELEGRAM_BOT_TOKEN from .env
    if grep -q "TELEGRAM_BOT_TOKEN=" "$env_file"; then
        TELEGRAM_BOT_TOKEN=$(grep "TELEGRAM_BOT_TOKEN=" "$env_file" | cut -d'=' -f2- | tr -d '"' | tr -d "'" | xargs)
    else
        print_error "TELEGRAM_BOT_TOKEN not found in .env file"
        exit 1
    fi
    
    # Check if token is set
    if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ "$TELEGRAM_BOT_TOKEN" = "your_bot_token_here" ]; then
        print_error "Please set your Telegram bot token in the .env file"
        echo "Get a token from @BotFather on Telegram"
        exit 1
    fi
    
    print_info "Found Telegram bot token: ${TELEGRAM_BOT_TOKEN:0:10}..."
}

# Function to get chat ID from Telegram API
get_chat_id() {
    local token="$1"
    local api_url="https://api.telegram.org/bot${token}/getUpdates"
    
    print_info "Fetching updates from Telegram API..."
    
    # Make API request
    local response
    response=$(curl -s -X GET "$api_url" || echo "")
    
    if [ -z "$response" ]; then
        print_error "Failed to connect to Telegram API"
        echo "Please check your internet connection and try again"
        return 1
    fi
    
    # Check for API errors
    if echo "$response" | jq -e '.ok == false' >/dev/null 2>&1; then
        local error_msg=$(echo "$response" | jq -r '.description // "Unknown error"')
        print_error "Telegram API error: $error_msg"
        
        if echo "$error_msg" | grep -qi "invalid token"; then
            echo "Please check your bot token in the .env file"
        fi
        return 1
    fi
    
    # Extract chat ID from response
    local chat_id
    chat_id=$(echo "$response" | jq -r '.result[0].message.chat.id // empty')
    
    if [ -n "$chat_id" ]; then
        print_success "Found chat ID: $chat_id"
        echo "$chat_id"
        return 0
    else
        print_warning "No chat ID found in response"
        print_info "You need to send a message to your bot first"
        return 1
    fi
}

# Function to prompt user to send a message
prompt_user_to_send_message() {
    local token="$1"
    local bot_username
    
    # Try to get bot username
    local bot_info=$(curl -s -X GET "https://api.telegram.org/bot${token}/getMe")
    bot_username=$(echo "$bot_info" | jq -r '.result.username // empty')
    
    if [ -n "$bot_username" ]; then
        print_info "Your bot username: @$bot_username"
    else
        print_warning "Could not retrieve bot username"
    fi
    
    echo ""
    echo "================================================"
    echo "ACTION REQUIRED: Send a message to your bot"
    echo "================================================"
    echo ""
    echo "1. Open Telegram"
    echo "2. Search for your bot: @$bot_username (if available)"
    echo "3. Send ANY message to the bot (e.g., 'Hello')"
    echo "4. Wait a few seconds, then press Enter to continue"
    echo ""
    echo -n "Press Enter when you've sent a message... "
    read -r
}

# Function to display chat ID information
display_chat_id() {
    local chat_id="$1"
    local env_file=".env"
    
    print_success "Found chat ID: $chat_id"
    echo ""
    echo "================================================"
    echo "Telegram Chat ID Information"
    echo "================================================"
    echo ""
    echo "Your Telegram Chat ID is: $chat_id"
    echo ""
    echo "To use this chat ID in your Elegoo Print Monitor:"
    echo ""
    echo "1. Open your .env file:"
    echo "   nano .env  # or your preferred editor"
    echo ""
    echo "2. Add or update the TELEGRAM_CHAT_ID line:"
    echo "   TELEGRAM_CHAT_ID=$chat_id"
    echo ""
    echo "3. Save the file and restart the print monitor"
    echo ""
    echo "Note: The script will NOT modify your .env file automatically."
    echo "You need to manually add the chat ID to your configuration."
}

# Function to test the chat ID
test_chat_id() {
    local token="$1"
    local chat_id="$2"
    
    print_info "Testing chat ID by sending a test message..."
    
    local api_url="https://api.telegram.org/bot${token}/sendMessage"
    local message="✅ Telegram bot configured successfully! This is a test message from Elegoo Print Monitor."
    
    local response
    response=$(curl -s -X POST "$api_url" \
        -d "chat_id=${chat_id}" \
        -d "text=${message}" \
        -d "parse_mode=Markdown")
    
    if echo "$response" | jq -e '.ok == true' >/dev/null 2>&1; then
        print_success "Test message sent successfully!"
        return 0
    else
        local error_msg=$(echo "$response" | jq -r '.description // "Unknown error"')
        print_warning "Failed to send test message: $error_msg"
        return 1
    fi
}

# Main function
main() {
    echo ""
    echo "================================================"
    echo "Telegram Chat ID Getter for Elegoo Print Monitor"
    echo "================================================"
    echo ""
    
    # Check dependencies
    check_dependencies
    
    # Read .env file
    read_env_file
    
    # Try to get chat ID
    local chat_id
    chat_id=$(get_chat_id "$TELEGRAM_BOT_TOKEN")
    
    # If no chat ID found, prompt user to send message
    if [ -z "$chat_id" ]; then
        prompt_user_to_send_message "$TELEGRAM_BOT_TOKEN"
        
        # Try again after user sends message
        print_info "Checking for new messages..."
        sleep 3  # Wait a bit for the message to be processed
        
        chat_id=$(get_chat_id "$TELEGRAM_BOT_TOKEN")
        
        if [ -z "$chat_id" ]; then
            print_error "Still no chat ID found. Please make sure you sent a message to the bot."
            echo "You can also manually get your chat ID by:"
            echo "1. Sending a message to @getidsbot on Telegram"
            echo "2. Or checking the response from /getUpdates API"
            exit 1
        fi
    fi
    
    # Display chat ID information
    display_chat_id "$chat_id"
    
    # Ask user if they want to test the configuration
    echo ""
    echo -n "Would you like to send a test message to verify the chat ID works? (y/N): "
    read -r test_response
    
    if [[ "$test_response" =~ ^[Yy]$ ]]; then
        if test_chat_id "$TELEGRAM_BOT_TOKEN" "$chat_id"; then
            echo ""
            print_success "Test message sent successfully!"
            echo "Your Telegram bot is properly configured."
        else
            echo ""
            print_warning "Test message failed."
            echo "You may need to check your bot permissions or chat ID."
        fi
    fi
    
    echo ""
    echo "Script completed."
}

# Run main function
main "$@"