// Syntax-check inline <script> blocks in every tracked HTML file.
import { execSync } from 'node:child_process'; import fs from 'node:fs'; import vm from 'node:vm';
const files = execSync('git ls-files "*.html"').toString().trim().split('\n'); let bad = 0;
for (const f of files) { const s = fs.readFileSync(f, 'utf8'); const re = /<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/(?:ld\+)?json|text\/template|importmap)")[^>]*>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(s))) { const code = m[1]; if (!code.trim()) continue; try { new vm.Script(code, { filename: f }); } catch (e) { if (/import|export/.test(e.message) && /type="module"/.test(m[0])) continue; bad++; console.log('BAD', f, e.message); } } }
console.log(bad ? `${bad} inline script error(s)` : 'inline scripts ok'); process.exit(bad ? 1 : 0);
