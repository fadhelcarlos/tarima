// Builds the site and publishes dist/ to the gh-pages branch (GitHub Pages).
import { execSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd, cwd = process.cwd()) => execSync(cmd, { cwd, stdio: 'inherit' });
run('npx tsc --noEmit');
run('npx vite build');
const remote = execSync('git remote get-url origin').toString().trim();
const dir = mkdtempSync(join(tmpdir(), 'tarima-pages-'));
cpSync('dist', dir, { recursive: true });
rmSync(join(dir, 'artifact.html'), { force: true });
// GitHub Pages must not run Jekyll on these files
execSync(`node -e "require('fs').writeFileSync('.nojekyll','')"`, { cwd: dir });
run('git init -q -b gh-pages', dir);
run('git add -A', dir);
run('git commit -q -m "Publicar sitio"', dir);
run(`git push -f -q ${remote} gh-pages`, dir);
rmSync(dir, { recursive: true, force: true });
console.log('Publicado en gh-pages');
