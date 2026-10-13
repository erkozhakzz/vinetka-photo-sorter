const asar = require('@electron/asar');
const path = require('path');
const fs = require('fs');

async function build() {
  const srcDir = __dirname;
  const outDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const tempAsar = path.join('C:', 'Temp', 'app.asar');
  const targetAsar = path.join(outDir, 'app.asar');
  if (fs.existsSync(tempAsar)) fs.unlinkSync(tempAsar);
  if (fs.existsSync(targetAsar)) fs.unlinkSync(targetAsar);
  
  console.log('Building app.asar...');
  await asar.createPackageWithOptions(srcDir, tempAsar, {
    unpack: '*.{node,dll}',
    filter: (filePath) => {
      const rel = path.relative(srcDir, filePath).replace(/\\/g, '/');
      if (!rel) return true;
      if (
        rel.startsWith('.git') ||
        rel.startsWith('dist') ||
        rel.startsWith('.vscode') ||
        rel.startsWith('node_modules/electron') ||
        rel.startsWith('node_modules/@electron') ||
        rel.startsWith('node_modules/.bin') ||
        rel.startsWith('node_modules/@types')
      ) return false;
      return true;
    }
  });
  fs.copyFileSync(tempAsar, targetAsar);
  console.log('Built app.asar successfully at:', targetAsar);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
