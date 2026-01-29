const { Queue } = require("bullmq");
const { connection } = require("./redis");

const videoQueue = new Queue("video", { connection });

module.exports = { videoQueue };
