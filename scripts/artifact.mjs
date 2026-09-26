// Turns dist/index.html into the fragment the claude.ai Artifact host expects
// (it wraps the page in its own doctype/head/body skeleton).
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const links = head.match(/<link[^>]+>/g)?.join('\n') ?? '';
const styles = head.match(/<style[\s\S]*?<\/style>/g)?.join('\n') ?? '';
const scripts = head.match(/<script[\s\S]*?<\/script>/g)?.join('\n') ?? '';
const out = `${title}\n${links}\n${styles}\n${body}\n${scripts}\n`;
writeFileSync('dist/artifact.html', out);
console.log(`artifact.html ${(out.length / 1024).toFixed(0)} KB`);
