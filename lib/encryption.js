/**
 * AES-256-GCM Token Encryption
 * Securely encrypts Monday.com OAuth tokens at rest
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV
const TAG_LENGTH = 16; // 128-bit auth tag
const KEY_LENGTH = 32; // 256-bit key

let encryptionKey = null;

/**
 * Initialize encryption key from environment
 */
function initializeKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  
  if (!keyHex) {
    throw new Error('ENCRYPTION_KEY environment variable is required for V2 mode');
  }
  
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  
  encryptionKey = Buffer.from(keyHex, 'hex');
  console.log('[Encryption] Key initialized successfully');
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string} plaintext - The text to encrypt
 * @returns {object} - { encrypted: hex, iv: hex, tag: hex }
 */
function encrypt(plaintext) {
  if (!encryptionKey) {
    initializeKey();
  }
  
  try {
    // Generate random IV for each encryption
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Create cipher
    const cipher = crypto.createCipher(ALGORITHM, encryptionKey);
    cipher.setAAD(Buffer.from('aria-v2-token')); // Additional authenticated data
    
    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get authentication tag
    const tag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    };
  } catch (error) {
    console.error('[Encryption] Encrypt failed:', error.message);
    throw new Error('Token encryption failed');
  }
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param {object} encryptedData - { encrypted: hex, iv: hex, tag: hex }
 * @returns {string|null} - Decrypted plaintext or null if failed
 */
function decrypt({ encrypted, iv, tag }) {
  if (!encryptionKey) {
    initializeKey();
  }
  
  try {
    // Convert hex strings back to buffers
    const ivBuffer = Buffer.from(iv, 'hex');
    const tagBuffer = Buffer.from(tag, 'hex');
    
    // Create decipher
    const decipher = crypto.createDecipher(ALGORITHM, encryptionKey);
    decipher.setAAD(Buffer.from('aria-v2-token'));
    decipher.setAuthTag(tagBuffer);
    
    // Decrypt
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('[Encryption] Decrypt failed:', error.message);
    return null; // Don't throw - return null for graceful handling
  }
}

/**
 * Generate a new 256-bit encryption key
 * @returns {string} - 64-character hex string
 */
function generateKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Check if encryption is properly configured
 * @returns {boolean}
 */
function isConfigured() {
  try {
    initializeKey();
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  generateKey,
  isConfigured
};