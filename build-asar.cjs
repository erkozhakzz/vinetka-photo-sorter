const asar = require('@electron/asar');
const path = require('path');
const fs = require('fs');

async function build() {
  const rootDir = __dirname;
  const outDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const staging = path.join('C:', 'Temp', 'vinetka_prod_app');
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  console.log('Staging production files...');
  const files = ['package.json', 'main.cjs', 'preload.cjs', 'parser.cjs', 'index.html', 'license.html', 'icon.png'];
  files.forEach(f => {
    const src = path.join(rootDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, f));
  });

  // Scripts & Models
  const scriptsDir = path.join(rootDir, 'scripts');
  if (fs.existsSync(scriptsDir)) fs.cpSync(scriptsDir, path.join(staging, 'scripts'), { recursive: true });

  const modelsDir = path.join(rootDir, 'models');
  if (fs.existsSync(modelsDir)) fs.cpSync(modelsDir, path.join(staging, 'models'), { recursive: true });

  // Node modules (exclude dev tools: electron, @electron, @types, .bin)
  const nmSrc = path.join(rootDir, 'node_modules');
  const nmDest = path.join(staging, 'node_modules');
  fs.mkdirSync(nmDest, { recursive: true });

  if (fs.existsSync(nmSrc)) {
    fs.readdirSync(nmSrc).forEach(item => {
      if (['electron', '@electron', '@types', '.bin'].includes(item)) return;
      fs.cpSync(path.join(nmSrc, item), path.join(nmDest, item), { recursive: true });
    });
  }

  const targetAsar = path.join(outDir, 'app.asar');
  if (fs.existsSync(targetAsar)) fs.unlinkSync(targetAsar);

  console.log('Packaging clean app.asar...');
  await asar.createPackage(staging, targetAsar);

  const stats = fs.statSync(targetAsar);
  console.log(`Success! Built app.asar (${(stats.size / 1024 / 1024).toFixed(2)} MB) at: ${targetAsar}`);

  // Cleanup staging
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
}

build().catch(err => {
  console.error('Build error:', err);
  process.exit(1);
});
