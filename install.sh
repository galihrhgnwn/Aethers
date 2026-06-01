#!/bin/bash

# Aether's Discord Bot - Installation & Startup Script

echo "==========================================="
echo "   Aether's Discord Bot Setup & Launcher   "
echo "==========================================="
echo ""

# Check for node modules
if [ ! -d "node_modules" ]; then
    echo "[*] Installing dependencies..."
    npm install
fi

echo "Please select how you want to run Aether's:"
echo "1) Run Bot Only (Minimal RAM Usage)"
echo "2) Run Both (Bot + Web Dashboard)"
echo "3) Run Userbot (Screen Share Only)"
echo "4) Run All Three (Bot + Web Dashboard + Userbot)"
echo ""
read -p "Enter your choice (1, 2, 3, or 4): " choice

echo ""

if [ "$choice" == "1" ]; then
    echo "Building Next.js (Minimal)..."
    npm run build
    echo "[*] Starting Bot Only..."
    npm run bot
elif [ "$choice" == "2" ]; then
    echo "Building Next.js..."
    npm run build
    echo "Starting services..."
    npm run start
elif [ "$choice" == "3" ]; then
    echo "[*] Starting Userbot Only..."
    npm run userbot
elif [ "$choice" == "4" ]; then
    echo "Building Next.js..."
    npm run build
    echo "[*] Starting Bot, Dashboard, and Userbot..."
    # We can run both processes together and wait for them
    npm run start & 
    npm run userbot & 
    wait
else
    echo "Invalid choice. Exiting."
    exit 1
fi
