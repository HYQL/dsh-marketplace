// Validate the profile patch + installed plugin config shapes.
const fs = require('fs');
const path = require('path');

// Resolve `yaml` without assuming a particular working directory or the
// presence of this plugin's own node_modules (the installed copy is a junction
// to local-plugins/, and deliberately ships without node_modules).
function loadYaml() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'yaml'),
    'E:\\dsh-work\\agnes-media\\node_modules\\yaml',
    'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\node_modules\\yaml',
    'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\node_modules\\dsh-agnes-studio\\node_modules\\yaml',
  ];
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  throw new Error('yaml module not found in any candidate location');
}
const yaml = loadYaml();

const patchPath = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\cordis.patch.yml';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e ? ' :: ' + e : '')); } };

console.log('--- profile patch YAML ---');
let doc;
try {
  doc = yaml.parse(fs.readFileSync(patchPath, 'utf8'));
  ok('patch parses', Array.isArray(doc));
} catch (e) { ok('patch parses', false, e.message); process.exit(1); }

const ids = doc.map((e) => e.id);
// The profile patch layer must NOT carry any agnes row. Both agnes plugins
// register themselves through their own bundle patch (`dsh.bundle.patch`),
// which DSH applies automatically. A row here is redundant and — historically —
// was part of what made the boot fail destructively.
ok('no agnes rows in profile patch', !ids.some((v) => String(v).startsWith('agnes')));
ok('no duplicate entry ids', new Set(ids).size === ids.length,
  ids.filter((v, i) => ids.indexOf(v) !== i).join(','));

console.log('--- profile package.json ---');
const pkg = JSON.parse(fs.readFileSync('C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\package.json', 'utf8'));
ok('bundle list includes agnes-media', pkg.dsh.profile.bundles.includes('agnes-media'));
ok('bundle list excludes retired legacy plugin', !pkg.dsh.profile.bundles.includes('dsh-agnes-media'));
ok('legacy plugin not a dependency', !Object.keys(pkg.dependencies).includes('dsh-agnes-media'));

console.log('--- installed plugin ---');
const dest = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\node_modules\\agnes-media';
ok('lib/host.js exists', fs.existsSync(path.join(dest, 'lib', 'host.js')));
ok('lib/client.js exists', fs.existsSync(path.join(dest, 'lib', 'client.js')));
const ppkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
ok('package name agnes-media', ppkg.name === 'agnes-media');
ok('main -> lib/host.js', ppkg.main === 'lib/host.js');
ok('client export -> lib/client.js', ppkg.exports['./client'] === './lib/client.js');
ok('declares bundle patch', ppkg.dsh.bundle.patch === './cordis.patch.yml');

console.log('--- plugin patch YAML ---');
const pdoc = yaml.parse(fs.readFileSync(path.join(dest, 'cordis.patch.yml'), 'utf8'));
const entry = pdoc[0].insert[0];
ok('inserts one entry', Array.isArray(pdoc[0].insert) && pdoc[0].insert.length === 1);
ok('entry id agnes-media-studio', entry.id === 'agnes-media-studio');
ok('entry name agnes-media', entry.name === 'agnes-media');
ok('config has site', entry.config.site === 'cn');
ok('config has imageModel', typeof entry.config.imageModel === 'string');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
