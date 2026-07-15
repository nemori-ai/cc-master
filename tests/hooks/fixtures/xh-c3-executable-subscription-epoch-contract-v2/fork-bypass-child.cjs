'use strict';

const { spawnSync } = require('node:child_process');
const http = require('node:http');

spawnSync('/usr/bin/systemctl', ['--version'], { stdio: 'ignore' });
const request = http.get('http://127.0.0.1:9');
request.on('error', () => process.exit(0));
setTimeout(() => process.exit(0), 1000);
