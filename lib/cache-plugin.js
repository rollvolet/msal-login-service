import fs from 'fs';

const cachePath = "/cache/token-cache.json";
/**
 * Cache Plugin configuration
 * Taken from https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/standalone-samples/silent-flow/index.js
 */

const beforeCacheAccess = async (cacheContext) => {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(cachePath)) {
      fs.readFile(cachePath, "utf-8", async (err, data) => {
        if (err) {
          console.log('Before cache access hook -- something went wrong reading cache');
          console.log(err);
          reject();
        } else {
          try {
            cacheContext.tokenCache.deserialize(data);
            resolve();
          } catch (ex) {
            console.log('Something went wrong while deserializing cache');
            console.log(ex);
            console.log('Resetting token cache (using library internals)');
            // The code below should actually be handled internally by msal-node
            // in TokenCache.deserialize() when deserialization of the JSON string
            // from the token cache file fails. Now the TokenCache is left
            // in an inconsistent state by the library.
            // We try to rollback to a consistent state using library internals.
            cacheContext.tokenCache.cacheSnapshot = ''; // JSON string from token-cache file
            cacheContext.hasChanged = true;
            persistCache(cacheContext, resolve, reject);
          }
        }
      });
    } else {
      persistCache(cacheContext, resolve, reject);
    }
  });
};

const afterCacheAccess = async (cacheContext) => {
  return new Promise((resolve, reject) => persistCache(cacheContext, resolve, reject));
};

const persistCache = (cacheContext, resolve, reject) => {
  if (cacheContext.cacheHasChanged) {
    console.log('Persisting token cache to file');
    fs.writeFile(cachePath, cacheContext.tokenCache.serialize(), (err) => {
      if (err) {
        console.log(err);
        reject(err);
      } else {
        resolve();
      }
    });
  } else {
    console.log('No changes. No need to update the persisted token cache');
    resolve();
  }
};

const cachePlugin = {
  beforeCacheAccess,
  afterCacheAccess
};

export default cachePlugin;
