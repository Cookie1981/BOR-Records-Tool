#!/bin/bash

set -e  # Exit on any error

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

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

port_in_use() {
    lsof -i :$1 >/dev/null 2>&1
}

kill_existing_server() {
    print_status "Checking for existing server on port 3000..."
    if port_in_use 3000; then
        print_warning "Port 3000 is in use. Stopping existing server..."
        pkill -f "node.*server.js" || true
        sleep 2
        if port_in_use 3000; then
            print_warning "Server still running. Trying to force kill..."
            lsof -ti:3000 | xargs kill -9 || true
            sleep 1
        fi
    fi
}

echo "🏹 Archery Scores Bulk Uploader"
echo "Starting the application..."
echo ""

# Change to the script directory (archery-backend)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if Node.js is installed
if ! command_exists node; then
    print_error "Node.js is not installed!"
    echo ""
    echo "Please run the setup script first:"
    echo "  ./setup.sh"
    echo ""
    exit 1
fi

# Check if package.json exists
if [[ ! -f "package.json" ]]; then
    print_error "package.json not found. Make sure you're in the archery-backend directory."
    exit 1
fi

# Check if node_modules exists (dependencies installed)
if [[ ! -d "node_modules" ]]; then
    print_error "Dependencies not installed!"
    echo ""
    echo "Please run the setup script first:"
    echo "  ./setup.sh"
    echo ""
    exit 1
fi

# Check if server.js exists
if [[ ! -f "server.js" ]]; then
    print_error "server.js not found in the current directory."
    exit 1
fi

kill_existing_server

print_status "Starting the Archery Scores Backend Server..."

node server.js &
SERVER_PID=$!

# Give the server a moment to start
sleep 3

# Check if the server is actually running
if ! ps -p $SERVER_PID > /dev/null; then
    print_error "Failed to start the server!"
    echo ""
    echo "Try running manually to see error details:"
    echo "  node server.js"
    exit 1
fi

# Test if server is responding
print_status "Testing server connection..."
if curl -s http://localhost:3000/api/health > /dev/null; then
    print_success "Server is running successfully on http://localhost:3000"
else
    print_error "Server started but is not responding. Please check for errors."
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

# Wait a moment for full startup
sleep 1

print_status "Opening web application in your default browser..."

# Open the web application in the default browser
if command_exists open; then
    # macOS
    open http://localhost:3000
elif command_exists xdg-open; then
    # Linux
    xdg-open http://localhost:3000
else
    print_warning "Could not automatically open browser. Please manually navigate to:"
    echo "  http://localhost:3000"
fi

echo ""
print_success "🎉 Application launched successfully!"
echo ""
echo "📋 What to do now:"
echo "  1. The web application should open automatically in your browser"
echo "  2. If it doesn't, navigate to: http://localhost:3000"
echo "  3. Use the application to upload your archery scores"
echo ""
echo "🛑 To stop the application:"
echo "  Press Ctrl+C in this terminal, or run:"
echo "  pkill -f \"node.*server.js\""
echo ""
echo "📝 Server is running with PID: $SERVER_PID"
echo "Press Ctrl+C to stop the server..."

# Keep the script running so the server doesn't stop
# This allows the user to stop with Ctrl+C
wait $SERVER_PID
