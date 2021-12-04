/**
 *  @file Batch Processing Module for ESOVDB Items using Redis to share batch state between PM2 cluster nodes
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @version 3.2.0
 *  @module batch
 */

exports.defineTags = function(dictionary) {
  dictionary.defineTag('sideEffects', {
    mustNotHaveValue: true
  });
}

/** @constant {number} batchInterval - The duration, in seconds after which the current [batch]{@link batch} data is considered stale (default: 10000ms = 10s) */
const batchInterval = 10 * 1000;

module.exports = {
  
  /**
   *  Appends a video to the current batch, as a Redis set item for batch processing
   *
   *  @async
   *  @method append
   *  @param {RedisClient} client - The currently connected Redis client instance
   *  @param {('create'|'update')} op - String representation of the current batch operation 
   *  @param {Object[]} videos - The surrounding array that encapsulates a video object coming from Airtable (ESOVDB)
   *  @param {Object} videos.video - The video from Airtable (ESOVDB) to be appended to the current batch
   *  @sideEffects Adds new batch data as redis set item under the redis key for the current batch
   *  @returns {Object[]} An array of all items in the Redis set representing the current batch
   */
  
  append: async (client, op, [ video ]) => {
    await client.sAdd(`batch:${op}`, JSON.stringify(video));
    const data = await client.sMembers(`batch:${op}`);
    return data.map((video) => JSON.parse(video));
  },
  
  /**
   *  Re-initializes the Redis key and set that will represent the next batch
   *
   *  @async
   *  @method clear
   *  @param {RedisClient} client - The currently connected Redis client instance
   *  @param {('create'|'update')} op - String representation of the current batch operation 
   *  @sideEffects Deletes Redis key for current batch
   */
  
  clear: async (client, op) => {
    console.log('cleaning up batch…');
    await client.del(`batch:${op}`);
  },
  
  /**
   *  Retrieves and returns all members of the Redis set representing the current batch
   *
   *  @async
   *  @method get
   *  @param {RedisClient} client - The currently connected Redis client instance
   *  @param {('create'|'update')} op - String representation of the current batch operation 
   *  @returns {Object[]} An array of video objects for batch processing
   */
  
  get: async (client, op) => {
    const data = await client.sMembers(`batch:${op}`);
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
   *  @param {RedisClient} client - The currently connected Redis client instance
   *  @param {('create'|'update')} op - String representation of the current batch operation 
   *  @returns {number} The length of the current batch, or cardinality of the Redis set representing the current batch
   */
  
  size: async (client, op) => await client.sCard(`batch:${op}`)
}