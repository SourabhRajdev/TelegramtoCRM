#!/usr/bin/env node

/**
 * Deploy Environment Variables to Railway
 * Reads .env file and pushes all variables to Railway project
 */

const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

// Get Railway credentials from command line or environment
const RAILWAY_TOKEN = process.argv[2] || process.env.RAILWAY_TOKEN;
const PROJECT_ID = process.argv[3] || process.env.RAILWAY_PROJECT_ID;
const ENVIRONMENT_ID = process.argv[4] || process.env.RAILWAY_ENVIRONMENT_ID || 'production';

if (!RAILWAY_TOKEN || !PROJECT_ID) {
    console.error('❌ Missing required parameters\n');
    console.error('Usage: node deploy-env-railway.js <RAILWAY_TOKEN> <PROJECT_ID> [ENVIRONMENT_ID]\n');
    console.error('Or set environment variables:');
    console.error('  RAILWAY_TOKEN=your_token');
    console.error('  RAILWAY_PROJECT_ID=your_project_id');
    console.error('  RAILWAY_ENVIRONMENT_ID=production (optional)\n');
    console.error('Get your Railway token from: https://railway.app/account/tokens');
    console.error('Get your Project ID from Railway dashboard URL\n');
    process.exit(1);
}

/**
 * Set a single environment variable on Railway
 */
async function setVariable(name, value) {
    const mutation = `
        mutation variableUpsert($input: VariableUpsertInput!) {
            variableUpsert(input: $input)
        }
    `;
    
    try {
        const response = await axios.post(RAILWAY_API, {
            query: mutation,
            variables: {
                input: {
                    projectId: PROJECT_ID,
                    environmentId: ENVIRONMENT_ID,
                    name: name,
                    value: value
                }
            }
        }, {
            headers: {
                'Authorization': `Bearer ${RAILWAY_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.data.errors) {
            throw new Error(response.data.errors[0].message);
        }
        
        return true;
    } catch (error) {
        console.error(`  ❌ Failed: ${error.message}`);
        return false;
    }
}

/**
 * Parse .env file and return key-value pairs
 */
function parseEnvFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const vars = {};
    
    for (const line of lines) {
        // Skip comments and empty lines
        if (line.trim().startsWith('#') || line.trim() === '') {
            continue;
        }
        
        // Parse KEY=VALUE
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            
            if (key && value) {
                vars[key] = value;
            }
        }
    }
    
    return vars;
}

/**
 * Main deployment function
 */
async function deploy() {
    console.log('🚂 Railway Environment Variable Deployment\n');
    console.log(`Project ID: ${PROJECT_ID}`);
    console.log(`Environment: ${ENVIRONMENT_ID}\n`);
    
    // Check if .env exists
    if (!fs.existsSync('.env')) {
        console.error('❌ .env file not found!');
        process.exit(1);
    }
    
    // Parse .env file
    console.log('📖 Reading .env file...');
    const envVars = parseEnvFile('.env');
    const varCount = Object.keys(envVars).length;
    console.log(`Found ${varCount} environment variables\n`);
    
    // Deploy each variable
    console.log('📤 Deploying variables to Railway...\n');
    let successCount = 0;
    let failCount = 0;
    
    for (const [key, value] of Object.entries(envVars)) {
        // Mask sensitive values in output
        const displayValue = ['TOKEN', 'KEY', 'SECRET', 'PASSWORD'].some(s => key.includes(s))
            ? '***' + value.slice(-4)
            : value.substring(0, 30) + (value.length > 30 ? '...' : '');
        
        process.stdout.write(`Setting ${key} = ${displayValue} ... `);
        
        const success = await setVariable(key, value);
        if (success) {
            console.log('✅');
            successCount++;
        } else {
            failCount++;
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Deployment complete!`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log('='.repeat(50) + '\n');
    
    if (successCount > 0) {
        console.log('📋 Next steps:');
        console.log('1. Trigger a new deployment on Railway dashboard');
        console.log('2. Or run: railway up');
        console.log('3. Check logs: railway logs');
        console.log('4. Test your bot on Telegram\n');
    }
    
    process.exit(failCount > 0 ? 1 : 0);
}

// Run deployment
deploy().catch(error => {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
});
