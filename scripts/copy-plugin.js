const fs = require('fs');
const path = require('path');
const { getPluginTargetDirs, markForHotReload } = require('./worktree-targets');

const distDir = path.join(__dirname, '..', 'dist');
const rootManifest = path.join(__dirname, '..', 'manifest.json');
// The built-in dice pack is read from the plugin folder at runtime.
const diceDir = path.join(__dirname, '..', 'dice');
const artifactFiles = [
  { source: path.join(distDir, 'main.js'), targetName: 'main.js', required: true },
  { source: path.join(distDir, 'styles.css'), targetName: 'styles.css', required: false },
  { source: rootManifest, targetName: 'manifest.json', required: true },
];

const targets = getPluginTargetDirs(path.join(__dirname, '..'));

const missingRequired = artifactFiles.filter((file) => file.required && !fs.existsSync(file.source));
if (missingRequired.length > 0) {
  console.error(
    '❌ Required build artifacts not found:',
    missingRequired.map((item) => item.source).join(', ')
  );
  process.exitCode = 1;
} else {
  let copiedCount = 0;

  for (const target of targets) {
    fs.mkdirSync(target.dirPath, { recursive: true });
    markForHotReload(target.dirPath);

    for (const file of artifactFiles) {
      if (!fs.existsSync(file.source)) continue;
      fs.copyFileSync(file.source, path.join(target.dirPath, file.targetName));
    }
    if (fs.existsSync(diceDir) && path.resolve(target.dirPath) !== path.resolve(__dirname, '..')) {
      fs.cpSync(diceDir, path.join(target.dirPath, 'dice'), { recursive: true });
    }

    copiedCount += 1;
    console.log(`✅ Copied plugin artifacts to ${target.label}`);
  }

  if (copiedCount === 0) {
    console.log('ℹ️ No local vault targets detected; skipping postbuild copy');
  }
}
