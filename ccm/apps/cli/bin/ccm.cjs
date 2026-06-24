#!/usr/bin/env node
'use strict';
// T0 占位薄入口 —— 跑构建产物里的 run()（tsdown 出 dist/index.cjs，备 SEA·T3）。
const { run } = require('../dist/index.cjs');
process.exit(run());
