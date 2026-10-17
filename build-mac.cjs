const { packager } = require('@electron/packager');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

async function buildMac(arch = 'arm64') {
  console.log(`\n==============================================`);
  console.log(`Building macOS package (${arch})...`);
  console.log(`==============================================`);

  const outDir = path.join(__dirname, 'dist', 'mac');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const appPaths = await packager({
    dir: __dirname,
    name: 'VINETKA Photo Sorter',
    platform: 'darwin',
    arch: arch,
    electronVersion: '32.1.2',
    out: outDir,
    overwrite: true,
    appBundleId: 'kz.vinetka.photosorter',
    appCategoryType: 'public.app-category.photography',
    appVersion: '2.2.7',
    buildVersion: '2.2.7',
    prune: true,
    asar: {
      unpack: '{scripts/**,models/**}'
    },
    ignore: [
      /^\/\.git/,
      /^\/dist/,
      /^\/tests/,
      /^\/scripts\/__pycache__/,
      /installer\.iss$/,
      /run\.bat$/,
      /TODO\.md$/,
      /GEMINI\.md$/
    ]
  });

  console.log(`✓ Mac package created at:`, appPaths[0]);
  
  // Create ZIP archive for easy distribution to Mac users
  const appFolder = appPaths[0];
  const zipName = `VINETKA-Photo-Sorter-macOS-${arch}.zip`;
  const zipPath = path.join(__dirname, 'dist', zipName);
  const desktopZip = path.join('C:\\Users\\Ереке\\Desktop', zipName);

  console.log(`Creating distributable ZIP: ${zipPath}...`);
  try {
    execSync(`powershell -Command "Compress-Archive -Path '${appFolder}\\*' -DestinationPath '${zipPath}' -Force"`);
    fs.copyFileSync(zipPath, desktopZip);
    const st = fs.statSync(desktopZip);
    console.log(`✓ Distributable macOS ZIP created: ${desktopZip} (${(st.size / (1024*1024)).toFixed(1)} MB)`);
  } catch (err) {
    console.error('Error creating ZIP:', err.message);
  }

  return appPaths;
}

async function main() {
  await buildMac('arm64');
}

main().catch(err => {
  console.error('Build error:', err);
  process.exit(1);
});
