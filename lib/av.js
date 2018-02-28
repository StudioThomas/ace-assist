const _ = require('lodash');
const Promise = require('bluebird');
const path = require('path');
const stream = require('stream');
const fs = Promise.promisifyAll(require('fs'));
const ffmpeg = Promise.promisifyAll(require('fluent-ffmpeg'));
// const Logger = require('./logger');

// const logInfo = Logger.info.bind(null, null, 'image');
// const logError = Logger.error.bind(null, null, 'image');

// ffmpeg.getAvailableFormats((err, formats) => {
//   console.log('Available formats:');
//   // console.dir(formats);
//   _.forEach(formats, (format, formatId) => {
//     console.log(formatId);
//   });
// });

// ffmpeg.getAvailableCodecs((err, codecs) => {
//   console.log('Available codecs:');
//   // console.dir(codecs);
//   _.forEach(codecs, (codec, codecId) => {
//     console.log(codecId);
//   });
// });

const placeholder = path.join(__dirname, '../assets/encoding.mp4');

module.exports = class AV {

  static get mimeTypes() {
    return {
      mp4: 'video/mp4',
      webm: 'video/webm',
      m3u8: 'application/x-mpegURL',
      ts: 'video/MP2T',
    };
  }

  static async process(filePath) {
    const metadata = await ffmpeg.ffprobeAsync(filePath);

    await AV.thumbnail(filePath);

    return metadata;
  }

  static thumbnail(filePath) {
    return new Promise((resolve, reject) => {
      const file = path.parse(filePath);

      ffmpeg(filePath)
        // .on('filenames', (filenames) => {
        //   console.log(`Video.thumbnail: ${filenames.join(', ')}`);
        // })
        .on('end', resolve)
        .on('error', reject)
        .screenshots({
          folder: path.join(file.dir, file.name),
          timestamps: [0],
          filename: 'thumb.jpg',
        });
    });
  }

  static async transform(input, settings, hashKey) {
    return new Promise((resolve, reject) => {
      const tmpFile = path.join(__dirname, '../tmp', `${hashKey}.${settings.outputFormat}`);

      if (fs.existsSync(tmpFile)) {
        resolve({
          placeholder,
        });
        return;
      }

      const command = ffmpeg(input);
      let passThroughStream;

      if (settings.outputFormat === 'mp4') {
        command
          .output(tmpFile)
          .format('mp4')
          .videoCodec('libx264')
          .audioCodec('libfdk_aac');
      }

      if (settings.outputFormat === 'webm') {
        command
          .output(tmpFile)
          .format('webm')
          .videoCodec('libvpx-vp9')
          .audioCodec('libvorbis');

        // passThroughStream = new stream.PassThrough();
        // command
        //   .output(passThroughStream)
        //   .format('webm')
        //   .videoCodec('libvpx-vp9')
        //   .audioCodec('libvorbis');
      }

      const bv = parseInt(settings.bv || 1000, 10);
      if (bv === 0) {
        command.noVideo();
      } else {
        command.videoBitrate(bv);
      }

      const ba = parseInt(settings.ba || 128, 10);
      if (ba === 0) {
        command.noAudio();
      } else {
        command.audioBitrate(ba);
      }

      if (settings.w || settings.h) {
        command.size(`${settings.w || '?'}x${settings.h || '?'}`);
      }

      if (settings.s) {
        command.seek(settings.s);
      }

      if (settings.d) {
        command.duration(settings.d);
      }

      command
        .on('start', (cmd) => {
          console.log('Video.transform: start:', cmd);
        })
        .on('progress', (progress) => {
          // console.log('Video.transform: progress:', progress);
        })
        .on('end', () => {
          console.log('Video.transform: end');
        })
        .on('error', (error) => {
          console.error('Video.transform: error:', error);
        });

      const promise = new Promise((resolve, reject) => {
        command
          .on('end', () => {
            resolve(tmpFile);
          })
          .on('error', (error) => {
            reject(error);
          });
      });

      command.run();

      resolve({
        ffmpeg: command,
        stream: passThroughStream,
        promise,
        placeholder,
      });
    });
  }

};