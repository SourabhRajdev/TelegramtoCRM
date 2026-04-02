/**
 * Operation Identity & Idempotency System
 * 
 * Prevents duplicate writes by tracking operation IDs.
 * Each write operation gets a deterministic ID based on:
 * - User intent
 * - Target entity
 * - Action type
 * - Timestamp window (5 min)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const OPERATIONS_DIR = path.join(__dirname, '..', 'data', 'operations');
const OPERATION_TTL = 45 * 1000; // 45 seconds — short dedup window; explicit "again" bypasses in caller

if (!fs.existsSync(OPERATIONS_DIR)) {
  fs.mkdirSync(OPERATIONS_DIR, { recursive: true });
}

/**
 * Generate deterministic operation ID
 */
function generateOperationId(intent, entities, actionType) {
  const components = [
    intent,
    actionType,
    entities.board || 'unknown',
    entities.person_name || '',
    JSON.stringify(entities.values_to_set || {}),
  ];
  
  // Round timestamp to 5-minute window to allow retries within window
  const timeWindow = Math.floor(Date.now() / OPERATION_TTL);
  components.push(timeWindow.toString());
  
  const hash = crypto
    .createHash('sha256')
    .update(components.join('|'))
    .digest('hex')
    .substring(0, 16);
  
  return `op_${hash}`;
}

/**
 * Check if operation already executed
 */
function isOperationExecuted(operationId) {
  const filePath = path.join(OPERATIONS_DIR, `${operationId}.json`);
  
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const age = Date.now() - data.timestamp;
    
    // Expired operations are considered not executed
    if (age > OPERATION_TTL) {
      fs.unlinkSync(filePath);
      return false;
    }
    
    return true;
  } catch (err) {
    logger.warn('Failed to read operation file', { operationId, error: err.message });
    return false;
  }
}

/**
 * Mark operation as executed
 */
function markOperationExecuted(operationId, details) {
  const filePath = path.join(OPERATIONS_DIR, `${operationId}.json`);
  
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      operationId,
      timestamp: Date.now(),
      details,
    }, null, 2));
  } catch (err) {
    logger.error('Failed to mark operation executed', { operationId, error: err.message });
  }
}

/**
 * Clean up expired operations
 */
function cleanupExpiredOperations() {
  try {
    const files = fs.readdirSync(OPERATIONS_DIR);
    const now = Date.now();
    let cleaned = 0;
    
    for (const file of files) {
      const filePath = path.join(OPERATIONS_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (now - data.timestamp > OPERATION_TTL) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (err) {
        // Invalid file, delete it
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info('Cleaned up expired operations', { count: cleaned });
    }
  } catch (err) {
    logger.error('Failed to cleanup operations', { error: err.message });
  }
}

// Cleanup every 10 minutes
setInterval(cleanupExpiredOperations, 10 * 60 * 1000);

module.exports = {
  generateOperationId,
  isOperationExecuted,
  markOperationExecuted,
  cleanupExpiredOperations,
};
