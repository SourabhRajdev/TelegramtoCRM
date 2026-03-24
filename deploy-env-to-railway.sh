#!/bin/bash

# Deploy Environment Variables to Railway
# Usage: ./deploy-env-to-railway.sh <RAILWAY_TOKEN> <PROJECT_ID> <ENVIRONMENT_ID>

set -e

RAILWAY_TOKEN="$1"
PROJECT_ID="$2"
ENVIRONMENT_ID="${3:-production}"

if [ -z "$RAILWAY_TOKEN" ] || [ -z "$PROJECT_ID" ]; then
    echo "Usage: $0 <RAILWAY_TOKEN> <PROJECT_ID> [ENVIRONMENT_ID]"
    echo ""
    echo "Get your Railway token from: https://railway.app/account/tokens"
    echo "Get your Project ID from Railway dashboard URL"
    exit 1
fi

echo "🚂 Deploying environment variables to Railway..."
echo "Project ID: $PROJECT_ID"
echo "Environment: $ENVIRONMENT_ID"
echo ""

# Load .env file
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    exit 1
fi

# Read .env and push each variable
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
    
    echo "Setting: $key"
    
    # Use Railway API to set variable
    curl -s -X POST "https://backboard.railway.app/graphql/v2" \
        -H "Authorization: Bearer $RAILWAY_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"query\": \"mutation variableUpsert(\$input: VariableUpsertInput!) { variableUpsert(input: \$input) }\",
            \"variables\": {
                \"input\": {
                    \"projectId\": \"$PROJECT_ID\",
                    \"environmentId\": \"$ENVIRONMENT_ID\",
                    \"name\": \"$key\",
                    \"value\": \"$value\"
                }
            }
        }" > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "  ✅ $key set successfully"
    else
        echo "  ❌ Failed to set $key"
    fi
    
done < .env

echo ""
echo "✅ Environment variables deployed to Railway!"
echo ""
echo "Next steps:"
echo "1. Trigger a new deployment on Railway"
echo "2. Check logs: railway logs"
echo "3. Test the bot on Telegram"
