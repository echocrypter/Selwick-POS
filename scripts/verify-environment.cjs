/**
 * Selwick POS Environment & Configuration Integrity Verification Script
 * Validates configuration files, branding assets, migration hooks, and build readiness.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let failed = 0;

function check(title, condition, detail = '') {
  if (condition) {
    console.log(`  [OK] ${title}`);
  } else {
    console.error(`  [FAIL] ${title} ${detail ? '(' + detail + ')' : ''}`);
    failed++;
  }
}

console.log('\n--- Checking Selwick POS Configuration & Environment Integrity ---\n');

// 1. Required configuration files exist
const requiredFiles = [
  'next.config.ts',
  'postcss.config.mjs',
  'tsconfig.json',
  'package.json',
  'electron/main.cjs',
  'src/app/globals.css',
  'src/app/layout.tsx',
  'src/app/page.tsx',
];

console.log('1. Checking required configuration files:');
for (const rel of requiredFiles) {
  check(`File exists: ${rel}`, fs.existsSync(path.join(root, rel)));
}

// 2. Next.js configuration verification
console.log('\n2. Checking next.config.ts settings:');
const nextConfigPath = path.join(root, 'next.config.ts');
if (fs.existsSync(nextConfigPath)) {
  const content = fs.readFileSync(nextConfigPath, 'utf8');
  check('output is "standalone"', content.includes('"standalone"'));
  check('allowedDevOrigins contains 127.0.0.1', content.includes('127.0.0.1'));
} else {
  check('next.config.ts present', false);
}

// 3. Tailwind CSS & PostCSS verification
console.log('\n3. Checking Tailwind v4 and PostCSS configuration:');
const postcssPath = path.join(root, 'postcss.config.mjs');
if (fs.existsSync(postcssPath)) {
  const content = fs.readFileSync(postcssPath, 'utf8');
  check('postcss.config.mjs configures @tailwindcss/postcss', content.includes('@tailwindcss/postcss'));
} else {
  check('postcss.config.mjs present', false);
}

const globalsCssPath = path.join(root, 'src/app/globals.css');
if (fs.existsSync(globalsCssPath)) {
  const content = fs.readFileSync(globalsCssPath, 'utf8');
  check('globals.css imports tailwindcss', content.includes('@import "tailwindcss"') || content.includes("@import 'tailwindcss'"));
} else {
  check('globals.css present', false);
}

// 4. Branding assets verification
console.log('\n4. Checking branding assets:');
const brandAssets = [
  'public/selwick-login-left.jpg',
  'public/selwick-logo.png',
  'electron/selwick-icon.ico',
];
for (const asset of brandAssets) {
  check(`Branding asset exists: ${asset}`, fs.existsSync(path.join(root, asset)));
}

// 5. Offline login & LocalStorage migration integration
console.log('\n5. Checking LocalStorage migration & Offline accounts:');
const migrationUtilPath = path.join(root, 'src/utils/localStorageMigration.ts');
const migrationModalPath = path.join(root, 'src/components/pos/LocalStorageMigrationModal.tsx');
const offlineStaffPath = path.join(root, 'src/components/pos/OfflineStaff.tsx');

check('Migration utility exists (localStorageMigration.ts)', fs.existsSync(migrationUtilPath));
check('Migration modal component exists (LocalStorageMigrationModal.tsx)', fs.existsSync(migrationModalPath));

if (fs.existsSync(offlineStaffPath)) {
  const staffContent = fs.readFileSync(offlineStaffPath, 'utf8');
  check('OfflineStaff imports LocalStorageMigrationModal', staffContent.includes('LocalStorageMigrationModal'));
  check('OfflineStaff renders migration modal button', staffContent.includes('Migrate / Restore POS Data Backup'));
} else {
  check('OfflineStaff.tsx present', false);
}

// 6. Electron configuration verification
console.log('\n6. Checking Electron configuration:');
const mainCjsPath = path.join(root, 'electron/main.cjs');
if (fs.existsSync(mainCjsPath)) {
  const mainContent = fs.readFileSync(mainCjsPath, 'utf8');
  check('Packaged production port remains fixed at 3456', mainContent.includes('3456'));
  check('Packaged origin is 127.0.0.1:3456', mainContent.includes('http://127.0.0.1:${port}') || mainContent.includes('http://127.0.0.1:3456'));
  check('Dev server detection probes for existing server', mainContent.includes('probe'));
} else {
  check('electron/main.cjs present', false);
}

console.log('\n--------------------------------------------------------------');
if (failed === 0) {
  console.log('All integrity checks passed successfully (0 failures).\n');
  process.exit(0);
} else {
  console.error(`Integrity check failed with ${failed} error(s).\n`);
  process.exit(1);
}
