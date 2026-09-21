import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sourceManagedDir = path.join(rootDir, 'contracts', 'managed', 'veilpass');
const targetPublicDir = path.join(rootDir, 'web', 'public', 'midnight', 'veilpass');

// Exact public circuit assets needed for browser proving/verifying
const assetsToCopy = [
  {
    from: path.join(sourceManagedDir, 'keys', 'checkEligibility.prover'),
    to: path.join(targetPublicDir, 'keys', 'checkEligibility.prover'),
  },
  {
    from: path.join(sourceManagedDir, 'keys', 'checkEligibility.verifier'),
    to: path.join(targetPublicDir, 'keys', 'checkEligibility.verifier'),
  },
  {
    from: path.join(sourceManagedDir, 'zkir', 'checkEligibility.bzkir'),
    to: path.join(targetPublicDir, 'zkir', 'checkEligibility.bzkir'),
  },
];

console.log('Copying public circuit assets to web/public/midnight/veilpass...');

for (const asset of assetsToCopy) {
  if (!fs.existsSync(asset.from)) {
    console.error(`Error: Source asset not found: ${asset.from}`);
    console.error('Run "npm run compile" first to generate managed contract artifacts.');
    process.exit(1);
  }

  const targetDir = path.dirname(asset.to);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(asset.from, asset.to);
  const size = fs.statSync(asset.to).size;
  console.log(`  ✓ ${path.relative(rootDir, asset.to)} (${size} bytes)`);
}

console.log('Artifacts copied successfully.');
