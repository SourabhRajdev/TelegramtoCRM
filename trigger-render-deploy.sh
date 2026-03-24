#!/bin/bash

# Trigger Render deployment via deploy hook
# Get your deploy hook URL from: Render Dashboard > Service > Settings > Deploy Hook

DEPLOY_HOOK_URL="$1"

if [ -z "$DEPLOY_HOOK_URL" ]; then
    echo "Usage: ./trigger-render-deploy.sh <DEPLOY_HOOK_URL>"
    echo ""
    echo "Get your deploy hook URL from:"
    echo "Render Dashboard > Your Service > Settings > Deploy Hook"
    exit 1
fi

echo "🚀 Triggering Render deployment..."
echo ""

response=$(curl -s -X POST "$DEPLOY_HOOK_URL")

if [ $? -eq 0 ]; then
    echo "✅ Deploy triggered successfully!"
    echo ""
    echo "Check deployment status at:"
    echo "https://dashboard.render.com"
else
    echo "❌ Deploy trigger failed"
    exit 1
fi
# Trigger redeploy 1774352110
