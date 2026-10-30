/**
 * Selwick POS — Production Ed25519 License Keypair Generator.
 *
 * Generates asymmetric Ed25519 keypairs for commercial licensing:
 *  - SPKI Public Key: embedded into the POS client for offline verification
 *  - PKCS#8 Private Key: configured on the License Server via SELWICK_LICENSE_PRIVATE_KEY
 *
 * Usage:
 *   node scripts/generate-license-keys.cjs
 *   node scripts/generate-license-keys.cjs --save-dev   (saves to .data/license_private_key.pem for local testing)
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function generateEd25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Verify self-consistency: sign a test challenge
  const challenge = Buffer.from('SELWICK_ED25519_KEY_VERIFICATION_TEST', 'utf8');
  const signature = crypto.sign(null, challenge, privateKey);
  const isValid = crypto.verify(null, challenge, publicKey, signature);

  if (!isValid) {
    throw new Error('Key generation failed cryptographic self-verification test.');
  }

  return { publicKey: publicKey.trim(), privateKey: privateKey.trim() };
}

if (require.main === module) {
  console.log('======================================================================');
  console.log('SELWICK POS — ED25519 ASYMMETRIC LICENSE KEY GENERATOR');
  console.log('======================================================================\n');

  const { publicKey, privateKey } = generateEd25519KeyPair();

  console.log('1. PUBLIC VERIFICATION KEY (embed in src/lib/licensing/keys.ts):');
  console.log('----------------------------------------------------------------------');
  console.log(publicKey);
  console.log('----------------------------------------------------------------------\n');

  console.log('2. PRIVATE SIGNING KEY (configure as SELWICK_LICENSE_PRIVATE_KEY on server):');
  console.log('----------------------------------------------------------------------');
  console.log(privateKey);
  console.log('----------------------------------------------------------------------\n');

  if (process.argv.includes('--save-dev')) {
    const dataDir = path.join(process.cwd(), '.data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const targetFile = path.join(dataDir, 'license_private_key.pem');
    fs.writeFileSync(targetFile, privateKey + '\n', 'utf8');
    console.log(`[SAVED] Private key written to: ${targetFile} (DEV ONLY - do not commit)\n`);
  }

  console.log('KEY VERIFICATION: Self-test passed. Signatures verified with SPKI public key.');
}

module.exports = { generateEd25519KeyPair };

