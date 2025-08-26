const fs = require('fs');
const path = require('path');
require('dotenv').config();

function createEnvironmentFile(templatePath, outputPath) {
  if (!fs.existsSync(templatePath)) {
    console.error(`Template file not found: ${templatePath}`);
    return;
  }

  let template = fs.readFileSync(templatePath, 'utf8');
  
  // Replace all ${VARIABLE_NAME} with actual environment variables
  template = template.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      console.warn(`Warning: Environment variable ${varName} not found`);
      return match; // Keep the placeholder if variable not found
    }
    return value;
  });

  fs.writeFileSync(outputPath, template);
  console.log(`Generated: ${outputPath}`);
}

const buildType = process.argv[2] || 'development';

if (buildType === 'production') {
  createEnvironmentFile('src/environments/environment.prod.template.ts', 'src/environments/environment.prod.ts');
} else {
  createEnvironmentFile('src/environments/environment.template.ts', 'src/environments/environment.ts');
}