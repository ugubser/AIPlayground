#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Building Firebase Functions...');

// Step 1: Copy the shared models.config.json to the src directory
const sourceConfigPath = path.join(__dirname, '../../shared/config/models.config.json');
const targetConfigPath = path.join(__dirname, '../src/models.config.json');

try {
  console.log('📋 Copying models.config.json...');
  fs.copyFileSync(sourceConfigPath, targetConfigPath);
  console.log('✅ models.config.json copied successfully');
} catch (error) {
  console.error('❌ Failed to copy models.config.json:', error.message);
  process.exit(1);
}

// Step 2: Run TypeScript compiler
try {
  console.log('🏗️  Compiling TypeScript...');
  execSync('tsc', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('✅ TypeScript compilation complete');
} catch (error) {
  console.error('❌ TypeScript compilation failed:', error.message);
  process.exit(1);
}

// Step 3: Copy models.config.json to the lib directory as well (for runtime)
const libConfigPath = path.join(__dirname, '../lib/models.config.json');
try {
  console.log('📋 Copying models.config.json to lib directory...');
  fs.copyFileSync(sourceConfigPath, libConfigPath);
  console.log('✅ models.config.json copied to lib directory');
} catch (error) {
  console.error('❌ Failed to copy models.config.json to lib:', error.message);
  process.exit(1);
}

console.log('🎉 Functions build completed successfully!');