#!/bin/bash

# Kill existing processes on port 3000 (FastAPI)
fuser -k 3000/tcp 2>/dev/null || lsof -ti:3000 | xargs kill -9 2>/dev/null

echo "Activating virtual environment..."
source .venv/bin/activate

echo "Starting FastAPI backend..."
nohup uvicorn api:app --host 0.0.0.0 --port 3000 > backend.log 2>&1 &

echo "Waiting for backend to start..."
sleep 3

echo "Starting localtunnel..."
# Using npx for localtunnel
nohup npx localtunnel --port 3000 --subdomain cafe24-dashb-kj > tunnel.log 2>&1 &

echo "Services restarted."
echo "Backend log: backend.log"
echo "Tunnel log: tunnel.log"
echo "URL: https://cafe24-dashb-kj.loca.lt"
