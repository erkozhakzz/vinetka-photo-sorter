const asar = require('@electron/asar');
const path = require('path');
const fs = require('fs');

async function build() {
  const srcDir = __dirname;
  const outDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const targetAsar = path.join(outDir, 'app.asar');
  console.log('Building app.asar...');
  await asar.createPackageWithOptions(srcDir, targetAsar, {
    unpack: '*.{node,dll}',
    filter: (filePath) => {
      const rel = path.relative(srcDir, filePath);
      if (!rel) return true;
      if (rel.startsWith('.git') || rel.startsWith('dist') || rel.startsWith('.vscode')) return false;
      return true;
    }
  });
  console.log('Built app.asar successfully at:', targetAsar);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
