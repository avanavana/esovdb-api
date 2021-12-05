/**
 *  @file Batch Processing for ESOVDB Items using Redis to share batch state between instances of node running in a PM2 cluster
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @version 4.0.0
 *  @module batch
 */

const { createClient } = require('redis');

const db = createClient();
db.on('error', (err) => console.log(`[Error] Couldn't connect to Redis.`, err));
db.on('connect', () => console.log('Connected to Redis'));

/** @constant {number} batchInterval - The duration, in seconds after which the current [batch]{@link batch} data is considered stale (default: 10000ms = 10s) */
const batchInterval = 10 * 1000;

module.exports = {

  /** @constant {RedisClient} db - Exports a RedisClient instance */
  
  db,
  
  /**
   *  Appends a video to the current batch, as a Redis set item for batch processing
   *
   *  @async
   *  @method append
   *  @param {('create'|'update')} op - String representation of the current batch operation 
   *  @param {Object[]} videos - The surrounding array that encapsulates a video object coming from Airtable (ESOVDB)
   *  @param {Object} videos.video - The video from Airtable (ESOVDB) to be appended to the current batch
   *  @sideEffects Adds new batch data as redis set item under the redis key for the current batch
   *  @returns {Object[]} An array of all items in the Redis set representing the current batch
   */
  
  append: async (op, [ video ]) => {
    await db.sAdd(`batch:${op}`, JSON.stringify(video));
    const data = await db.sMembers(`batch:${op}`);
    return data.map((video) => JSON.parse(video));
  },
  
  /**
   *  Re-initializes the Redis key and set that will represent the next batch
   *
   *  @async
   *  @method clear
   *  @param {('create'|'update')} op - String representation of the current batch operation 
   *  @sideEffects Deletes Redis key for current batch
   */
  
  clear: async (op) => {
    console.log('cleaning up batch…');
    await db.del(`batch:${op}`);
  },
  
  /**
   *  Retrieves and returns all members of the Redis set representing the current batch
   *
   *  @async
   *  @method get
   *  @param {('create'|'update')} op - String representation of the current batch operation 
   *  @returns {Object[]} An array of video objects for batch processing
   */
  
  get: async (op) => {
    const data = await db.sMembers(`batch:${op}`);
    return data.map((video) => JSON.parse(video));
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
   *  @param {('create'|'update')} op - String representation of the current batch operation 
   *  @returns {number} The length of the current batch, or cardinality of the Redis set representing the current batch
   */
  
  size: async (op) => await db.sCard(`batch:${op}`)
}