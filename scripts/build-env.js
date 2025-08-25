#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
require('dotenv').config();

function createEnvironmentFile(templatePath, outputPath) {
  if (!fs.existsSync(templatePath)) {
    console.error(`Template file not found: ${templatePath}`);
    process.exit(1);
  }

  let template = fs.readFileSync(templatePath, 'utf8');
  
  // Replace environment variables
  const requiredVars = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN', 
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'FIREBASE_MEASUREMENT_ID'
  ];

  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (!value) {
      console.error(`Missing required environment variable: ${varName}`);
      process.exit(1);
    }
    template = template.replace(new RegExp(`\\$\\{${varName}\\}`, 'g'), value);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, template);
  console.log(`Created environment file: ${outputPath}`);
}

// Create development environment
createEnvironmentFile(
  'src/environments/environment.template.ts',
  'src/environments/environment.ts'
);

// Create production environment  
createEnvironmentFile(
  'src/environments/environment.prod.template.ts',
  'src/environments/environment.prod.ts'
);

console.log('Environment files generated successfully!');