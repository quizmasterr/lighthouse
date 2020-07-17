/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use strict';

/* eslint-disable no-console */

/** @typedef {{name: string, version: string, gzip: number, description: string, repository: string}} BundlePhobiaLibrary */

const fs = require('fs');
const exec = require('child_process').exec;

/** @type string[] */
const libraries = require('../audits/byte-efficiency/library-suggestions.js').suggestions.flat();
const databasePath = '../audits/byte-efficiency/bundlephobia-database.json';

/** @type {Record<string, Record<'lastScraped', number|string> | Record<string, BundlePhobiaLibrary>>} */
let database = {};
if (fs.existsSync(databasePath)) {
  database = require(databasePath);
}

/**
 * Returns true if this library has been scraped from BundlePhobia in the past week.
 * @param {string} library
 * @return {boolean}
 */
function hasBeenRecentlyScraped(library) {
  if (!database[library] || database[library].lastScraped === 'Error') return false;
  return (Date.now() - database[library].lastScraped) / (1000 * 60 * 60 * 24.0) < 7;
}

/**
 * Returns true if the object represents valid BundlePhobia JSON.
 * The version string must not match this false-positive expression: '{number} packages'.
 * @param {any} library
 * @return {boolean}
 */
function validateLibraryObject(library) {
  return library.hasOwnProperty('name') &&
    library.hasOwnProperty('size') &&
    library.hasOwnProperty('gzip') &&
    library.hasOwnProperty('description') &&
    library.hasOwnProperty('repository') &&
    library.hasOwnProperty('version') &&
    !library.version.match(/^([0-9]+) packages$/);
}

/**
 * Save BundlePhobia stats for a given npm library to the database.
 * @param {string} library
 * @param {number} index
 */
async function collectLibraryStats(library, index) {
  return new Promise((resolve, reject) => {
    console.log(`\n◉ (${index}/${libraries.length}) ${library} `);

    if (hasBeenRecentlyScraped(library)) {
      console.log(`   ❕ Skipping`);
      resolve();
      return;
    }

    exec(`bundle-phobia ${library} -j -r`, (error, stdout) => {
      if (error) {
        console.log(`    ❌ Failed to run "bundle-phobia ${library}" | ${error}`);
        reject();
        return;
      }

      /** @type {Array<BundlePhobiaLibrary>} */
      const libraries = [];
      /** @type {string|number} */
      let lastScraped = Date.now();

      for (const libraryString of stdout.split('\n')) {
        try {
          if (libraryString.length > 0) {
            const library = JSON.parse(libraryString);
            if (validateLibraryObject(library)) libraries.push(library);
          }
        } catch (e) {
          console.log(`   ❌ Failed to parse JSON | ${library}`);
          lastScraped = 'Error';
        }
      }

      for (let index = 0; index < libraries.length; index++) {
        const library = libraries[index];

        database[library.name] = {
          ...database[library.name],
          [library.version]: {
            name: library.name,
            version: library.version,
            gzip: library.gzip,
            description: library.description,
            repository: library.repository,
          },
          lastScraped,
        };

        if (index === 0) {
          database[library.name]['latest'] = database[library.name][library.version];
        }

        console.log(`   ✔ ${library.version}` + (index === 0 ? ' (latest)' : ''));
      }

      resolve();
    });
  });
}

(async () => {
  const startTime = new Date();
  console.log(`Collecting ${libraries.length} libraries...`);

  for (let i = 0; i < libraries.length; i++) {
    try {
      await collectLibraryStats(libraries[i], i + 1);
    } catch (e) {
      console.log('Exiting early...\n');
      break;
    }
  }

  console.log(`\n◉ Saving database to ${databasePath}...`);
  fs.writeFile(databasePath, JSON.stringify(database, null, 2), (err) => {
    if (err) {
      console.log(`   ❌ Failed saving | ${err}`);
    } else {
      console.log(`   ✔ Done!`);
    }
    console.log(`\nElapsed Time: ${(new Date() - startTime) / 1000}`);
  });
})();
