// Copy the static page into _site/ next to the data and feeds that `agent-price-feed build` wrote.
import { cpSync, existsSync } from 'node:fs';

if (!existsSync('_site/data/events.json')) throw new Error('run `node src/cli.mjs build` first');
cpSync('web', '_site', { recursive: true });
console.log('built _site/');
