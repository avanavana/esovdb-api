/**
 *  @file Batch Processing Module for ESOVDB Items
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @module batch
 */

/** @constant {Map} batch - Data structure for storing sequential requests for eventual batch processing. */
const batch = new Map([
  [ 'size', 0 ],
  [ 'content', [] ],
  [ 'modifiedTime', 0 ]
]);

/** @constant {number} batchInterval - The duration, in seconds after which the current [batch]{@link batch} data is considered stale (default: 10000ms = 10s) */
const batchInterval = 10 * 1000;

module.exports = {
  
  /**
   *  Appends a video to the current batch [content]{@link batch.content} array, for batch processing
   *
   *  @method append
   *  @param {Object[]} videos - The surrounding array that encapsulates a video object coming from Airtable (ESOVDB)
   *  @param {Object} videos.video - The video from Airtable (ESOVDB) to be appended to the current batch
   *  @modifies {Map} batch - sets three key value pairs on the Map {@link batch}
   *  @returns {Object[]} An array of all items in the current batch
   */
  
  append: ([ video ]) => {
    batch.set('size', batch.get('size') + 1);
    batch.set('content', [ ...batch.get('content'), video ]);
    batch.set('modifiedTime', new Date().getTime());
    return batch.get('content');
  },
  
  /**
   *  Re-initializes the [batch]{@link batch} Map to its original state, with size=0 and content=[]
   *
   *  @method clear
   *  @modifies {Map} batch - sets three key value pairs on the Map {@link batch}
   */
  
  clear: () => {
    batch.set('size', 0);
    batch.set('content', []);
    batch.set('modifiedTime', 0);
  },
  
  /**
   *  Determines whether or not the current {@link batch} data is expired, based on the duration of {@link batchInterval}
   *
   *  @method isExpired
   *  @param {number} [interval={@link batchInterval}] - The duration, in milliseconds,  kkskeeeeeeeeee
   *  @returns {Boolean} Whether or not the current {@link batch} data is expired
   */
  
  isExpired: (interval=batchInterval) => new Date().getTime() - batch.get('modifiedTime') > interval,
  
  /**
   *  Retrieves the current state of the batch [content]{@link batch.content} array and returns it
   *
   *  @method get
   *  @returns {Object[]} An array of video objects for batch processing
   */
  
  get: () => batch.get('content'),
  
  /**
   *  Retrieves the value of the const {@link batchInterval}
   *
   *  @method interval
   *  @returns {number} The value of {@link batchInterval}
   */
  
  interval: () => batchInterval,
  
  /**
   *  Retrieves the current length of the batch [content]{@link batch.content} array and returns it
   *
   *  @method size
   *  @returns {number} The current length of the batch [content]{@link batch.content} array
   */
  
  size: () => batch.get('size'),
}