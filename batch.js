/**
 *  @file Batch Processing for ESOVDB Items using Upstash Redis to share batch state between instances of node running in a PM2 cluster
 *  @author Avana Vana <avana@esovdb.org>
 *  @version 4.0.0
 *  @module batch
 */

const { Redis } = require('@upstash/redis');
const cronitor = require('cronitor')(process.env.CRONITOR_API_KEY);

const monitor = new cronitor.Monitor('api-server-telemetry');

const listeners = {
  connect: [],
  error: [],
};

function emit(event, value) {
  for (const handler of listeners[event] || []) {
    try {
      handler(value);
    } catch (err) {
      console.error(`[Error] Failed to run ${event} handler.`, err);
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`[Error] Missing required environment variable ${name}.`);
  return value;
}

const redis = new Redis({
  url: requireEnv('UPSTASH_REDIS_REST_URL'),
  token: requireEnv('UPSTASH_REDIS_REST_TOKEN'),
});

const db = {
  on(event, handler) {
    if (listeners[event]) listeners[event].push(handler);
    return db;
  },

  async connect() {
    try {
      await redis.ping();
      emit('connect');
    } catch (err) {
      emit('error', err);
      throw err;
    }
  },

  async quit() {
    return true;
  },

  async sAdd(key, members) {
    if (!members.length) return 0;
    return redis.sadd(key, ...members);
  },

  async sMembers(key) {
    const data = await redis.smembers(key);
    return Array.isArray(data) ? data : [];
  },

  async del(key) {
    return redis.del(key);
  },

  async sCard(key) {
    const size = await redis.scard(key);
    return Number(size) || 0;
  },
};

db.on('error', (err) => {
  monitor.ping({ state: 'fail', message: 'Unable to connect to Upstash Redis.' });
  console.log(`[Error] Couldn't connect to Upstash Redis.`, err);
});

db.on('connect', () => {
  monitor.ping({ state: 'ok', message: 'Connected to Upstash Redis.' });
  console.log('Connected to Upstash Redis');
});

/** @constant {number} batchInterval - The duration, in seconds after which the current [batch]{@link batch} data is considered stale (default: 10000ms = 10s) */
const batchInterval = 10 * 1000;

module.exports = {
  /** @constant {Object} db - Exports an Upstash-backed Redis client wrapper */
  db,

  /** @constant {CronitorMonitor} monitor - Exports a Cronitor Monitor instance for recording telemetry events */
  monitor,

  /**
   *  Appends an object or multiple objects to the current batch, as part of a Redis set used for batch processing
   *
   *  @async
   *  @method append
   *  @param {string} kind - String representation of the type of resource being synced, sent via URL parameter (e.g. 'items' or 'collections')
   *  @param {('create'|'update')} op - String representation of the current batch operation
   *  @param {Object[]} items - An array of objects from Airtable (ESOVDB) to be appended to the current batch
   *  @sideEffects Adds new batch data as redis set item under the redis key for the current batch
   *  @returns {Promise<Object[]>} A promise that resolves to an array of all items in the Redis set representing the current batch
   */
  append: async (kind, op, items) => {
    await db.sAdd(`batch:${kind}:${op}`, items.map((item) => JSON.stringify(item)));
    const data = await db.sMembers(`batch:${kind}:${op}`);
    return data.map((item) => JSON.parse(item));
  },

  /**
   *  Re-initializes the Redis key and set that will represent the next batch
   *
   *  @async
   *  @method clear
   *  @param {string} kind - String representation of the type of resource being synced, sent via URL parameter (e.g. 'items' or 'collections')
   *  @param {('create'|'update')} op - String representation of the current batch operation
   *  @sideEffects Deletes Redis key for current batch
   */
  clear: async (kind, op) => {
    await db.del(`batch:${kind}:${op}`);
  },

  /**
   *  Retrieves and returns all members of the Redis set representing the current batch
   *
   *  @async
   *  @method get
   *  @param {string} kind - String representation of the type of resource being synced, sent via URL parameter (e.g. 'items' or 'collections')
   *  @param {('create'|'update')} op - String representation of the current batch operation
   *  @returns {Object[]} An array of objects for batch processing
   */
  get: async (kind, op) => {
    const data = await db.sMembers(`batch:${kind}:${op}`);
    return data.map((item) => JSON.parse(item));
  },

  /**
   *  Retrieves the value of the const {@link batchInterval}
   *
   *  @method interval
   *  @returns {number} The value of {@link batchInterval}
   */
  interval: () => batchInterval,

  /**
   *  Retrieves and returns the size of the current batch, or the cardinality of the Redis set representing the current batch
   *
   *  @async
   *  @method size
   *  @param {string} kind - String representation of the type of resource being synced, sent via URL parameter (e.g. 'items' or 'collections')
   *  @param {('create'|'update')} op - String representation of the current batch operation
   *  @returns {Promise<number>} A promise that resolves to the length of the current batch, or cardinality of the Redis set representing the current batch
   */
  size: async (kind, op) => await db.sCard(`batch:${kind}:${op}`),
};
