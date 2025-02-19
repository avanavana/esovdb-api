/**
 *  @file Node-based cron job methods
 *  @author Avana Vana <avana@esovdb.org>
 *  @module cron
 */

const dotenv = require('dotenv').config();
const cron = require('node-cron');
const esovdb = require('./esovdb');
const youtube = require('./youtube');

/**
 *  Picks a random number from within a range for choosing a random node
 *
 *  @private
 *  @function randomNode
 *  @param {number} range - An integer number of nodes
 *  @returns {number} A random number from 0 to {@link range}, representing the index of a randomly-chosen node
 */

const randomNode = (range) => Math.floor(Math.random() * range);

module.exports = {
  
  /** @constant {cron.ScheduledTask} getLatest - A scheduled cron task to check and cache all videos modified in the ESOVDB in the past 24 hours */
  getLatest: cron.schedule('0 0 * * *', async () =>  {
    console.log('Performing daily cache of recently modified videos…');
    await esovdb.updateLatest(false);
  },{
    scheduled: false
  }),

  /** @constant {cron.ScheduledTask} checkNextYouTubeChannel - A scheduled cron task to check the next YouTube channel in the watch list for new videos to add to the ESOVDB */
  checkNextYouTubeChannel: cron.schedule('0 */6 * * *', async () => {
    console.log('Checking next YouTube channel in watch list…');
    await youtube.checkWatchedChannel();
  }, {
    scheduled: false
  }),
  
  /**
   *  Starts each job according to its schedule, one by one, on only one random node in the cluster
   *
   *  @method startJobs
   *  @param {(cron.ScheduledTask[]|cron.ScheduledTask)} jobs - Either an array of [ScheduledTasks]{@link cron.ScheduledTask} created by the [node-cron]{@link cron} library, or a single [ScheduledTask]{@link cron.ScheduledTask}
   *  @sideEffects Starts one or more [ScheduledTask]{@link cron.ScheduledTask} cron jobs using the [node-cron]{@link cron} library
   */
  
  startJobs: (jobs) => {
    jobs = Array.isArray(jobs) ? jobs : Array.of(jobs);
    for (const job of jobs) if (process.env.NODE_APP_INSTANCE === randomNode(3)) job.start();
  },
  
  /**
   *  Clears each job one by one from whichever node on which it is running
   *
   *  @method stopJobs
   *  @sideEffects Clears all running [ScheduledTask]{@link cron.ScheduledTask} cron jobs from every node, using the [node-cron]{@link cron} library
   */
  
  stopJobs: () => {
    for (const job of cron.getTasks()) job.stop();
  }
};