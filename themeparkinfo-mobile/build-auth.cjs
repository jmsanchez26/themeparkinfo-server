const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');
const destination = path.resolve(__dirname, '../public/assets/js/auth.bundle.js');
esbuild.buildSync({ entryPoints: [path.join(__dirname, 'auth-client.js')], outfile: destination,
  bundle: true, minify: true, format: 'iife', target: ['es2022'], legalComments: 'eof' });
fs.copyFileSync(destination, path.resolve(__dirname, 'www/assets/js/auth.bundle.js'));
console.log('Built Firebase account client for web and mobile.');
