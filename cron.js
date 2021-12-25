/**
 *  @file Node-based cron job methods
 *  @author Avana Vana <dear.avana@gmail.com>
 *  @module cron
 */

const dotenv = require('dotenv').config();
const cron = require('node-cron');
const esovdb = require('./esovdb');

const randomNode = (range) => Math.floor(Math.random() * range);

module.exports = {
  getLatest: cron.schedule('0 0 * * *', async () =>  {
    console.log('Performing daily cache of recently modified videos…');
    await esovdb.updateLatest(false);
  },{
    scheduled: false
  }),
  
  startJobs: (jobs) => {
    jobs = Array.isArray(jobs) ? jobs : Array.of(jobs);
    for (const job of jobs) if (process.env.NODE_APP_INSTANCE === randomNode(3)) job.start();
  },
  
  destroyJobs: () => {
    if (process.env.NODE_APP_INSTANCE === randomNode(3)) for (const job of cron.getTasks()) job.destroy();
  }
};