import fs from 'fs';

const cachePath = "/cache/token-cache.json";
/**
 * Cache Plugin configuration
 * Taken from https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/standalone-samples/silent-flow/index.js
 */

const beforeCacheAccess = async (cacheContext) => {
  return new Promise(async (resolve, reject) => {
    if (fs.existsSync(cachePath)) {
      fs.readFile(cachePath, "utf-8", (err, data) => {
        if (err) {
          reject();
        } else {
          cacheContext.tokenCache.deserialize(data);
          resolve();
        }
      });
    } else {
      fs.writeFile(cachePath, cacheContext.tokenCache.serialize(), (err) => {
        if (err) {
          reject();
        }
      });
    }
  });
};

const afterCacheAccess = async (cacheContext) => {
  return new Promise(async (resolve, reject) => {
    if (cacheContext.cacheHasChanged){
      fs.writeFile(cachePath, cacheContext.tokenCache.serialize(), (err) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
};

const cachePlugin = {
  beforeCacheAccess,
  afterCacheAccess
};

export default cachePlugin;
