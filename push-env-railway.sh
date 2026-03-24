#!/bin/bash

# Push all environment variables from .env to Railway
# Uses Railway CLI

set -e

echo "🚂 Pushing environment variables to Railway..."
echo ""

if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it first:"
    echo "npm install -g @railway/cli"
    exit 1
fi

if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    exit 1
fi

# Read and push each variable
count=0
while IFS='=' read -r key value; do
    # Skip comments and empty lines
    if [[ $key =~ ^#.*$ ]] || [[ -z $key ]]; then
        continue
    fi
    
    # Remove leading/trailing whitespace
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    
    # Skip if empty
    if [[ -z $key ]] || [[ -z $value ]]; then
        continue
    fi
    
    # Mask sensitive values in output
    if [[ $key == *"TOKEN"* ]] || [[ $key == *"KEY"* ]] || [[ $key == *"SECRET"* ]]; then
        display_value="***${value: -4}"
    else
        display_value="${value:0:30}"
        if [ ${#value} -gt 30 ]; then
            display_value="${display_value}..."
        fi
    fi
    
    echo "Setting: $key = $display_value"
    railway variables --set "$key=$value" 2>&1 | grep -v "Warning" || true
    
    count=$((count + 1))
    
done < .env

echo ""
echo "✅ Pushed $count environment variables to Railway!"
echo ""
echo "Next steps:"
echo "1. Deploy: railway up"
echo "2. Check logs: railway logs"
echo "3. Test the bot"
