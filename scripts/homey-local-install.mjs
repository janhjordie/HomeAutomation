#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function resolveGlobalHomeyRoot() {
  if (process.env.HOMEY_CLI_ROOT) {
    return process.env.HOMEY_CLI_ROOT;
  }

  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const homeyRoot = join(globalRoot, 'homey');
    if (existsSync(join(homeyRoot, 'lib/AppFactory.js'))) {
      return homeyRoot;
    }
  } catch {
    // fall through
  }

  try {
    const homeyBin = execSync('command -v homey', { encoding: 'utf8' }).trim();
    const homeyRoot = join(dirname(homeyBin), '..', 'lib', 'node_modules', 'homey');
    if (existsSync(join(homeyRoot, 'lib/AppFactory.js'))) {
      return homeyRoot;
    }
  } catch {
    // fall through
  }

  throw new Error('Kunne ikke finde global homey CLI. Installer med: npm install -g homey');
}

async function loadHomeyModules() {
  const homeyRoot = resolveGlobalHomeyRoot();
  const appFactoryModule = await import(
    pathToFileURL(join(homeyRoot, 'lib/AppFactory.js')).href
  );
  const homeyApiModule = await import(
    pathToFileURL(join(homeyRoot, 'node_modules/homey-api/index.js')).href
  );

  return {
    AppFactory: appFactoryModule.default,
    HomeyAPI: homeyApiModule.HomeyAPI
  };
}

function loadCliSettings() {
  const settingsPath = join(homedir(), '.athom-cli/settings.json');
  return JSON.parse(readFileSync(settingsPath, 'utf8'));
}

function resolveAddress() {
  if (process.env.HOMEY_ADDRESS) {
    return process.env.HOMEY_ADDRESS.trim();
  }

  const addressFile = join(repoRoot, 'Homey/.homey-address');
  if (existsSync(addressFile)) {
    return readFileSync(addressFile, 'utf8').trim();
  }

  throw new Error(
    'Mangler Homey-adresse. Saet HOMEY_ADDRESS eller opret Homey/.homey-address med fx https://192-168-86-38.homey.homeylocal.com'
  );
}

function resolveToken(settings) {
  const homeyId = settings.activeHomey?.id;
  if (!homeyId) {
    throw new Error('Ingen aktiv Homey i ~/.athom-cli/settings.json. Koer "homey select" naar cloud virker igen.');
  }

  const token = settings.homeyApi?.[`homey-${homeyId}`]?.token;
  if (!token) {
    throw new Error(`Ingen lokal token for Homey ${homeyId}. Log ind med "homey login" naar cloud virker igen.`);
  }

  return token;
}

const { AppFactory, HomeyAPI } = await loadHomeyModules();
const appPath = process.argv[2] || join(repoRoot, 'Homey/com.janhjordie.evchargeplanner');
const resolvedAppPath = resolve(appPath);
process.chdir(resolvedAppPath);
const settings = loadCliSettings();
const address = resolveAddress();
const token = resolveToken(settings);

const homey = await HomeyAPI.createLocalAPI({ address, token });
const app = AppFactory.getAppInstance(resolvedAppPath);
await app.install({ homey });
