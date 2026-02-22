/**
 *  @file Node-based cron job methods
 *  @author Avana Vana <avana@esovdb.org>
 *  @module cron
 */

const dotenv = require('dotenv').config();
const cron = require('node-cron');
const esovdb = require('./esovdb');
const youtube = require('./youtube');

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
   *  Starts each task according to its schedule, one by one, on the leader instance (index === 0) in the cluster
   *
   *  @method startTasks
   *  @param {(cron.ScheduledTask[]|cron.ScheduledTask)} tasks - Either an array of [ScheduledTasks]{@link cron.ScheduledTask} created by the [node-cron]{@link cron} library, or a single [ScheduledTask]{@link cron.ScheduledTask}
   *  @sideEffects Starts one or more [ScheduledTask]{@link cron.ScheduledTask} cron tasks using the [node-cron]{@link cron} library
   */
  
  startTasks: (tasks) => {
    tasks = Array.isArray(tasks) ? tasks : [ tasks ];
    const currentIndex = Number.parseInt(process.env.NODE_APP_INSTANCE ? process.env.NODE_APP_INSTANCE : '0', 10);
    const isLeader = currentIndex === 0;
    console.log(`[CRON] NODE_APP_INSTANCE=${currentIndex} ` + (isLeader ? '(starting tasks)' : '(not leader; skipping tasks)'));
    if (!isLeader) return;
    for (const task of tasks) task.start();
  },
  
  /**
   *  Clears each task one by one from whichever node on which it is running
   *
   *  @method stopTasks
   *  @sideEffects Clears all running [ScheduledTask]{@link cron.ScheduledTask} cron tasks from the current node (which should be the leader instance), using the [node-cron]{@link cron} library
   */
  
  stopTasks: () => {
    console.log('[CRON] typeof cron.getTasks:', typeof cron.getTasks);

    let tasks;
    
    try {
      tasks = (typeof cron.getTasks === 'function') ? cron.getTasks() : cron.getTasks;
    } catch (err) {
      console.error('[CRON] cron.getTasks threw:', err);
      return;
    }

    console.log('[CRON] getTasks() tag:', Object.prototype.toString.call(tasks));

    if (!tasks) return;

    if (typeof tasks.forEach === 'function' && typeof tasks.size === 'number') {
      tasks.forEach((task) => {
        if (task && typeof task.stop === 'function') task.stop();
      });
      
      return;
    }

    if (typeof tasks === 'object') {
      const keys = Object.keys(tasks);
      
      for (let i = 0; i < keys.length; i++) {
        const t = tasks[keys[i]];
        if (t && typeof t.stop === 'function') t.stop();
      }
      
      return;
    }

    console.warn('[CRON] stopTasks: unexpected tasks value:', tasks);
  },
};