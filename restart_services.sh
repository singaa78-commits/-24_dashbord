#!/bin/bash
source .env

# Kill existing processes on port 3000 (FastAPI)
fuser -k 3000/tcp 2>/dev/null || lsof -ti:3000 | xargs kill -9 2>/dev/null

echo "Activating virtual environment..."
source .venv/bin/activate

echo "Starting FastAPI backend..."
nohup uvicorn api:app --host 0.0.0.0 --port 3000 > backend.log 2>&1 &

echo "Waiting for backend to start..."
sleep 3

echo "Starting tunnel (ngrok)..."
NGROK_BIN="./node_modules/ngrok/bin/ngrok"
if [ ! -f "$NGROK_BIN" ]; then
    NGROK_BIN="ngrok"
fi

if [ -z "$NGROK_DOMAIN" ]; then
    echo "NGROK_DOMAIN not set in .env. Checking for REDIRECT_URI..."
    # Extract domain from REDIRECT_URI if available
    NGROK_DOMAIN=$(echo $REDIRECT_URI | sed -E 's|https://([^/]+)/.*|\1|')
fi

if [ ! -z "$NGROK_DOMAIN" ] && [ "$NGROK_DOMAIN" != "YOUR_STABLE_DOMAIN_HERE" ]; then
    echo "Using domain: $NGROK_DOMAIN"
    nohup "$NGROK_BIN" http 3000 --url="https://$NGROK_DOMAIN" > tunnel.log 2>&1 &
else
    echo "Starting ngrok with random domain (not recommended)..."
    nohup "$NGROK_BIN" http 3000 > tunnel.log 2>&1 &
fi

echo "Services restarted."
echo "Backend log: backend.log"
echo "Tunnel log: tunnel.log"
