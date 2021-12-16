/**
 *  @file Batch Processing for ESOVDB Items using Redis to share batch state between instances of node running in a PM2 cluster
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @version 4.0.0
 *  @module batch
 */

const { createClient } = require('redis');
const cronitor = require('cronitor')(process.env.CRONITOR_API_KEY);

const monitor = new cronitor.Monitor('api-server-telemetry');

const db = createClient();
db.on('error', (err) => { monitor.ping({ state: 'fail', message: 'Unable to connect to Redis.' }); console.log(`[Error] Couldn't connect to Redis.`, err); });
db.on('connect', () => { monitor.ping({ state: 'ok', message: 'Connected to Redis.' }); console.log('Connected to Redis'); });

/** @constant {number} batchInterval - The duration, in seconds after which the current [batch]{@link batch} data is considered stale (default: 10000ms = 10s) */
const batchInterval = 10 * 1000;

module.exports = {

  /** @constant {RedisClient} db - Exports a RedisClient instance */
  
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
   *  @returns {Object[]} An array of all items in the Redis set representing the current batch
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
   *  @returns {number} The length of the current batch, or cardinality of the Redis set representing the current batch
   */
  
  size: async (kind, op) => await db.sCard(`batch:${kind}:${op}`)
}