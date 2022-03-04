import RedisTokenCache from './redis-token-cache';

/**
 * Cache Plugin configuration.
 * Inspired by https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/ExpressTestApp/TestApp/App/utils/cachePlugin.js
 */

export default class SessionCachePlugin {
  constructor() {
    this.redisCache = new RedisTokenCache();
    this.sessionUri = null;
  }

  async beforeCacheAccess (cacheContext) {
    return new Promise(async (resolve, reject) => {
      try {
        const cacheData = await this.redisCache.get(this.sessionUri);
        try {
          cacheContext.tokenCache.deserialize(cacheData);
          resolve();
        } catch (err) {
          console.log('Something went wrong while deserializing cache');
          console.log(err);
          console.log('Resetting token cache (using library internals)');
          // The code below should actually be handled internally by msal-node
          // in TokenCache.deserialize() when deserialization of the JSON string
          // from the token cache file fails. Now the TokenCache is left
          // in an inconsistent state by the library.
          // We try to rollback to a consistent state using library internals.
          cacheContext.tokenCache.cacheSnapshot = ''; // JSON string from token-cache file
          cacheContext.hasChanged = true;
          this.persistCache(cacheContext, resolve, reject);
        }
      } catch (error) {
        console.log(`Before cache access hook -- something went wrong getting cache entry for session ${this.sessionUri}.`);
        console.log(error);
        reject(error);
      };
    });
  }

  async afterCacheAccess (cacheContext) {
    return new Promise((resolve, reject) => this.persistCache(cacheContext, resolve, reject));
  }

  async persistCache(cacheContext, resolve, reject) {
    if (cacheContext.cacheHasChanged) {
      const cacheData = cacheContext.tokenCache.serialize();
      try {
        await this.redisCache.set(this.sessionUri, cacheData);
        resolve();
      } catch (err) {
        console.log(`Something went wrong setting cache entry for session ${this.sessionUri}.`);
        console.log(err);
        reject(err);
      };
    } else {
      console.log('No changes. No need to update the persisted token cache');
      resolve();
    }
  }
}
