import { createClient } from 'redis';

const redisEndpoint = process.env.REDIS_ENDPOINT || 'redis://token-cache:6379';

export default class RedisTokenCache {
  constructor() {
    this.client = createClient({ url: redisEndpoint });
    this.client.on('error', console.error);
  }

  async get(key) {
    await this.client.connect();
    console.log(`Fetching value for key ${key} from redis`);
    const resp = await this.client.get(key);
    await this.client.quit();
    return resp;
  }

  async set(key, value) {
    await this.client.connect();
    console.log(`Storing value for ${key} in redis`);
    const resp = await this.client.set(key, value);
    await this.client.quit();
    return resp;
  }

  async cleanAllExcept(keys) {
    await this.client.connect();
    for await (const key of this.client.scanIterator()) {
      if (!keys.includes(key)) {
        await this.client.del(key);
      }
    }
    await this.client.quit();
  }
}
