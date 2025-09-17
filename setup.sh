#!/bin/bash

set -e  # Exit on any error

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

print_status() {
    echo -e "\033[1;34m[INFO]\033[0m $1"
}

print_success() {
    echo -e "\033[1;32m[SUCCESS]\033[0m $1"
}

print_error() {
    echo -e "\033[1;31m[ERROR]\033[0m $1"
}

print_warning() {
    echo -e "\033[1;33m[WARNING]\033[0m $1"
}

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_error "This script is designed for macOS. Please install Node.js manually."
    exit 1
fi

print_status "Checking system requirements..."

# Check if Homebrew is installed
if ! command_exists brew; then
    print_status "Homebrew not found. Installing Homebrew..."
    echo "You may be prompted for your password..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH for the rest of this script
    if [[ -f "/opt/homebrew/bin/brew" ]]; then
        # Apple Silicon Mac
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f "/usr/local/bin/brew" ]]; then
        # Intel Mac
        echo 'eval "$(/usr/local/bin/brew shellenv)"' >> ~/.zprofile
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    
    print_success "Homebrew installed successfully!"
else
    print_success "Homebrew is already installed."
fi

# Check if Node.js is installed
if ! command_exists node; then
    print_status "Node.js not found. Installing Node.js via Homebrew..."
    brew install node
    print_success "Node.js installed successfully!"
else
    NODE_VERSION=$(node --version)
    print_success "Node.js is already installed (version: $NODE_VERSION)"
    
    # Check if Node version is recent enough (v16+)
    NODE_MAJOR=$(echo $NODE_VERSION | sed 's/v\([0-9]*\).*/\1/')
    if [ "$NODE_MAJOR" -lt 16 ]; then
        print_warning "Node.js version is older than v16. Updating..."
        brew upgrade node
        print_success "Node.js updated!"
    fi
fi

# Verify npm is available
if ! command_exists npm; then
    print_error "npm not found even after Node.js installation. Please restart your terminal and try again."
    exit 1
fi

print_status "Installing project dependencies..."

# Change to the archery-backend directory (script should be run from there)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if package.json exists
if [[ ! -f "package.json" ]]; then
    print_error "package.json not found. Make sure you're running this from the archery-backend directory."
    exit 1
fi

# Install npm dependencies
npm install --production

print_success "All dependencies installed successfully!"

# Create uploads directory if it doesn't exist
if [[ ! -d "uploads" ]]; then
    mkdir uploads
    print_status "Created uploads directory"
fi

# Setup environment variables
print_status "Setting up environment variables..."

# Check if .env already exists
if [[ -f ".env" ]]; then
    print_warning ".env file already exists. Skipping API key setup."
    echo "If you need to update your API key, edit the .env file manually."
else
    echo ""
    echo "🔑 API Key Configuration"
    echo "The application requires an API key to connect to the archery records system."
    echo ""
    
    # Prompt for API key with validation
    while true; do
        echo "Please enter your Archery API key (just the token, without 'X ' prefix)."
        echo -n "You can find it at https://archery-records.net/records/account on the bottom right: "
        read -r USER_TOKEN
        
        # Basic validation
        if [[ -z "$USER_TOKEN" ]]; then
            print_error "API key cannot be empty. Please try again."
            continue
        fi
        
        # Remove any existing "X " prefix if user included it anyway
        if [[ "$USER_TOKEN" =~ ^X\ (.+) ]]; then
            USER_TOKEN="${BASH_REMATCH[1]}"
            echo "✅ Removed 'X ' prefix from your input - we'll add it automatically."
        fi
        
        # Validate token format (should be reasonable length)
        if [[ ${#USER_TOKEN} -lt 10 ]]; then
            print_warning "API token seems unusually short (${#USER_TOKEN} characters). Are you sure this is correct?"
            echo -n "Continue anyway? (y/N): "
            read -r CONTINUE
            if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
                continue
            fi
        fi
        
        # Automatically prefix with "X "
        API_KEY="X $USER_TOKEN"
        echo "✅ API key configured with 'X ' prefix."
        break
    done
    
    # Create .env file
    print_status "Creating .env file with your API key..."
    cat > .env << EOF
# Archery Scores Bulk Uploader - Environment Variables
# DO NOT COMMIT THIS FILE TO VERSION CONTROL

# Your archery API authentication token
ARCHERY_API_KEY=$API_KEY

# API base URL
ARCHERY_API_BASE_URL=https://api.archery-records.net
EOF
    
    print_success ".env file created successfully!"
    print_status "Your API key is now securely stored in the .env file"
fi

echo ""
echo "🎉 Setup complete! You can now run the application using:"
echo "   ./launch.sh"
echo ""
echo "Or manually with:"
echo "   node server.js"
echo ""
print_success "Setup finished successfully!"
